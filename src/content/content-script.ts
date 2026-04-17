// Content script: runs in isolated world at document_start.
// 1. Injects error-capture.ts into the main world
// 2. Relays captured errors to the service worker
// 3. Handles autofill requests from the side panel

import type { Message, AutofillUserPayload, AutofillResult } from '../lib/types.js';

// Inject the main-world error capture script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('dist/content/error-capture.js');
script.type = 'module';
(document.documentElement || document.head || document.body).appendChild(script);
script.onload = () => script.remove();

// Relay errors from the main world to the service worker
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'qassist-error-capture') return;

  chrome.runtime.sendMessage({
    type: 'console-error',
    error: event.data.error,
  });
});

// ── Autofill ──

// Map a user payload field onto the HTML autocomplete-attribute tokens it satisfies
// (https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill).
const AUTOCOMPLETE_MAP: Record<string, (keyof AutofillUserPayload)[]> = {
  'given-name': ['firstName'],
  'family-name': ['lastName'],
  'name': ['fullName'],
  'email': ['email'],
  'tel': ['phone'],
  'tel-national': ['phone'],
  'bday': ['birthday'],
  'street-address': ['street'],
  'address-line1': ['street'],
  'address-level2': ['city'],
  'address-level1': ['state'],
  'postal-code': ['zip'],
  'country': ['countryCode'],
  'country-name': ['country'],
};

// Fallback regex matchers against name/id/placeholder/aria-label when autocomplete
// isn't set. First match wins — order matters.
const HEURISTICS: Array<{ re: RegExp; field: keyof AutofillUserPayload }> = [
  { re: /^(first.?name|given.?name|fname|firstname)$/i, field: 'firstName' },
  { re: /^(last.?name|family.?name|surname|lname|lastname)$/i, field: 'lastName' },
  { re: /^(full.?name|your.?name|name)$/i, field: 'fullName' },
  { re: /e-?mail/i, field: 'email' },
  { re: /phone|tel(ephone)?|mobile/i, field: 'phone' },
  { re: /birth|dob|bday/i, field: 'birthday' },
  { re: /street|address.?(line)?.?1|address$|addr/i, field: 'street' },
  { re: /city|town|locality/i, field: 'city' },
  { re: /state|province|region/i, field: 'state' },
  { re: /zip|postal|postcode/i, field: 'zip' },
  { re: /country/i, field: 'country' },
];

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if ((el as HTMLInputElement).type === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

function fieldForAutocomplete(token: string): keyof AutofillUserPayload | null {
  const normalized = token.trim().toLowerCase();
  // autocomplete can be a space-separated list of tokens (e.g. "shipping street-address")
  const parts = normalized.split(/\s+/);
  for (const part of parts) {
    const match = AUTOCOMPLETE_MAP[part];
    if (match) return match[0];
  }
  return null;
}

function fieldForHeuristic(el: Fillable): keyof AutofillUserPayload | null {
  const haystack = [
    el.getAttribute('name'),
    el.id,
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
  ].filter(Boolean).join(' ');
  if (!haystack) return null;
  for (const { re, field } of HEURISTICS) {
    if (re.test(haystack)) return field;
  }
  return null;
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  // Use the native setter so React/Vue's synthetic-event listeners notice the change.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setSelectValue(el: HTMLSelectElement, value: string): boolean {
  const normalized = value.toLowerCase();
  for (const opt of Array.from(el.options)) {
    if (
      opt.value.toLowerCase() === normalized ||
      opt.textContent?.trim().toLowerCase() === normalized
    ) {
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

function fillDateInput(el: HTMLInputElement, birthday: string): boolean {
  // <input type="date"> expects YYYY-MM-DD, which is exactly our format
  if (el.type === 'date') {
    setInputValue(el, birthday);
    return true;
  }
  setInputValue(el, birthday);
  return true;
}

function autofillUser(user: AutofillUserPayload): AutofillResult {
  const inputs = Array.from(document.querySelectorAll<Fillable>('input, textarea, select'));
  let filled = 0;
  let skipped = 0;
  const fields: string[] = [];

  for (const el of inputs) {
    if (!isVisible(el)) continue;
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) continue;

    // Skip sensitive input types outright
    const type = (el as HTMLInputElement).type?.toLowerCase?.();
    if (type === 'password' || type === 'file' || type === 'hidden' || type === 'submit' || type === 'button') continue;

    const ac = el.getAttribute('autocomplete');
    let field = ac ? fieldForAutocomplete(ac) : null;
    if (!field) field = fieldForHeuristic(el);
    if (!field) {
      skipped++;
      continue;
    }

    const value = user[field];
    if (!value) continue;

    if (el instanceof HTMLSelectElement) {
      // For country selects, try both the name and code
      if (field === 'country' || field === 'countryCode') {
        const ok =
          setSelectValue(el, user.country) ||
          setSelectValue(el, user.countryCode);
        if (ok) { filled++; fields.push(field); }
      } else if (setSelectValue(el, value)) {
        filled++; fields.push(field);
      }
    } else if (el instanceof HTMLInputElement && (el.type === 'date' || field === 'birthday')) {
      fillDateInput(el, user.birthday);
      filled++;
      fields.push(field);
    } else {
      setInputValue(el, value);
      filled++;
      fields.push(field);
    }
  }

  return { filled, skipped, fields };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'autofill-user') {
    try {
      const result = autofillUser(message.user);
      sendResponse({ type: 'autofill-result', result });
    } catch (err) {
      sendResponse({
        type: 'autofill-result',
        result: { filled: 0, skipped: 0, fields: [], error: err instanceof Error ? err.message : String(err) },
      });
    }
    return true;
  }
});
