import type { BugReport, EnvironmentInfo, TabData } from '../lib/types.js';
import { formatAsMarkdown } from '../lib/formatter.js';
import { JiraClient, JiraError, JiraNotLoggedInError, type JiraProject, type JiraIssueType, type JiraPriority } from '../lib/jira-client.js';
import { getJiraConfig, getLastSelections, setLastSelections, getUsergenCountry, setUsergenCountry } from '../lib/storage.js';
import { generateFakeUser, SUPPORTED_COUNTRIES, type FakeUser } from '../lib/fake-user.js';
import type { AutofillResult, AutofillUserPayload } from '../lib/types.js';
import { initTheme } from '../lib/theme.js';
import {
  loadUsers,
  loadStrangeStuff,
  saveUsers,
  saveStrangeStuff,
  generateId,
  CACHE_KEYS,
  type QaUser,
  type QaStrangeEntry,
} from '../lib/qa-lists.js';

// Apply theme ASAP to minimize flash on side-panel open.
initTheme();

// ── Views ──
const pickerView = document.getElementById('picker-view') as HTMLDivElement;
const jiraView = document.getElementById('jira-view') as HTMLDivElement;
const usergenView = document.getElementById('usergen-view') as HTMLDivElement;
const usersView = document.getElementById('users-view') as HTMLDivElement;
const strangeView = document.getElementById('strange-view') as HTMLDivElement;
const viewTitle = document.getElementById('view-title') as HTMLHeadingElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const btnOptions = document.getElementById('btn-options') as HTMLButtonElement;

// ── Jira view DOM ──
const btnCapture = document.getElementById('btn-capture') as HTMLButtonElement;
const screenshotThumbs = document.getElementById('screenshot-thumbs') as HTMLDivElement;
const screenshotCountEl = document.getElementById('screenshot-count') as HTMLSpanElement;
const bugTitle = document.getElementById('bug-title') as HTMLInputElement;
const steps = document.getElementById('steps') as HTMLTextAreaElement;
const expected = document.getElementById('expected') as HTMLTextAreaElement;
const actual = document.getElementById('actual') as HTMLTextAreaElement;
const envInfo = document.getElementById('env-info') as HTMLPreElement;
const errorsSection = document.getElementById('errors-section') as HTMLDivElement;
const errorCount = document.getElementById('error-count') as HTMLSpanElement;
const errorsList = document.getElementById('errors-list') as HTMLPreElement;
const requestsSection = document.getElementById('requests-section') as HTMLDivElement;
const requestCount = document.getElementById('request-count') as HTMLSpanElement;
const requestsList = document.getElementById('requests-list') as HTMLPreElement;
const jiraPanel = document.getElementById('jira-panel') as HTMLDivElement;
const jiraProject = document.getElementById('jira-project') as HTMLSelectElement;
const jiraIssueType = document.getElementById('jira-issue-type') as HTMLSelectElement;
const jiraPriority = document.getElementById('jira-priority') as HTMLSelectElement;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const btnJira = document.getElementById('btn-jira') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// ── User generator view DOM ──
const btnUsergenGenerate = document.getElementById('btn-usergen-generate') as HTMLButtonElement;
const btnUsergenCopyAll = document.getElementById('btn-usergen-copy-all') as HTMLButtonElement;
const btnUsergenAutofill = document.getElementById('btn-usergen-autofill') as HTMLButtonElement;
const btnUsergenAddToUsers = document.getElementById('btn-usergen-add-to-users') as HTMLButtonElement;
const btnUsergenMailinator = document.getElementById('btn-usergen-mailinator') as HTMLButtonElement;
const usergenCountry = document.getElementById('usergen-country') as HTMLSelectElement;
const usergenPlaceholder = document.getElementById('usergen-placeholder') as HTMLDivElement;
const usergenResults = document.getElementById('usergen-results') as HTMLDivElement;
const usergenStatus = document.getElementById('usergen-status') as HTMLDivElement;

// Populate country dropdown once. The "Any country" option is already in the
// HTML; relabel it to "Global" to match the requested UX.
const anyOpt = usergenCountry.querySelector('option[value=""]');
if (anyOpt) anyOpt.textContent = 'Global (any)';
for (const { country, countryCode } of SUPPORTED_COUNTRIES) {
  const opt = document.createElement('option');
  opt.value = countryCode;
  opt.textContent = country;
  usergenCountry.appendChild(opt);
}

// Restore the last-used country selection, then persist any future changes.
getUsergenCountry().then((stored) => {
  // Only apply if the stored value matches one of our current options
  // (so stale codes from a wider list don't leave the picker blank unexpectedly).
  const optionExists = Array.from(usergenCountry.options).some((o) => o.value === stored);
  if (optionExists) usergenCountry.value = stored;
});
usergenCountry.addEventListener('change', () => {
  setUsergenCountry(usergenCountry.value);
});

// ── State ──
const screenshots: string[] = [];
let environment: EnvironmentInfo;
let tabData: TabData = { consoleErrors: [], failedRequests: [] };
let jiraClient: JiraClient | null = null;
let jiraAvailable = false;
let jiraInitComplete = false;
let jiraInitStarted = false;
let currentUser: FakeUser | null = null;

// ── View switching ──
type Mode = 'picker' | 'jira' | 'usergen' | 'users' | 'strange';

function showView(mode: Mode) {
  pickerView.style.display = mode === 'picker' ? 'block' : 'none';
  jiraView.style.display = mode === 'jira' ? 'block' : 'none';
  usergenView.style.display = mode === 'usergen' ? 'block' : 'none';
  usersView.style.display = mode === 'users' ? 'block' : 'none';
  strangeView.style.display = mode === 'strange' ? 'block' : 'none';
  btnBack.style.display = mode === 'picker' ? 'none' : 'inline-block';

  if (mode === 'picker') viewTitle.textContent = 'qassist';
  else if (mode === 'jira') viewTitle.textContent = 'Create Jira Issue';
  else if (mode === 'usergen') viewTitle.textContent = 'Generate User';
  else if (mode === 'users') viewTitle.textContent = 'Users List';
  else viewTitle.textContent = 'Strange Stuff';
}

let usersInitStarted = false;
let strangeInitStarted = false;

document.querySelectorAll('.tile').forEach((tile) => {
  tile.addEventListener('click', () => {
    const mode = (tile as HTMLElement).dataset.mode as Exclude<Mode, 'picker'>;
    showView(mode);
    if (mode === 'jira' && !jiraInitStarted) {
      jiraInitStarted = true;
      initJiraView();
    } else if (mode === 'users' && !usersInitStarted) {
      usersInitStarted = true;
      initUsersView();
    } else if (mode === 'strange' && !strangeInitStarted) {
      strangeInitStarted = true;
      initStrangeView();
    }
  });
});

btnBack.addEventListener('click', () => showView('picker'));

// Collapsible sections (Jira view)
document.querySelectorAll('.section-header[data-toggle]').forEach((header) => {
  header.addEventListener('click', () => {
    const targetId = (header as HTMLElement).dataset.toggle!;
    const target = document.getElementById(targetId);
    if (target) {
      target.classList.toggle('collapsed');
      header.classList.toggle('collapsed');
    }
  });
});

// ── Jira logic ──
function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = 'Unknown';
  let os = 'Unknown';

  if (ua.includes('Mac OS X')) {
    const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
    os = match ? `macOS ${match[1].replace(/_/g, '.')}` : 'macOS';
  } else if (ua.includes('Windows NT')) {
    const match = ua.match(/Windows NT ([\d.]+)/);
    const versions: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    os = match ? `Windows ${versions[match[1]] ?? match[1]}` : 'Windows';
  } else if (ua.includes('Linux')) {
    os = 'Linux';
  }

  if (ua.includes('Edg/')) {
    const match = ua.match(/Edg\/([\d.]+)/);
    browser = `Edge ${match?.[1] ?? ''}`;
  } else if (ua.includes('Chrome/')) {
    const match = ua.match(/Chrome\/([\d.]+)/);
    browser = `Chrome ${match?.[1] ?? ''}`;
  } else if (ua.includes('Firefox/')) {
    const match = ua.match(/Firefox\/([\d.]+)/);
    browser = `Firefox ${match?.[1] ?? ''}`;
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    const match = ua.match(/Version\/([\d.]+)/);
    browser = `Safari ${match?.[1] ?? ''}`;
  }

  return { browser: browser.trim(), os };
}

function showStatus(html: string, type: 'success' | 'error' | 'info', persist = false) {
  statusEl.innerHTML = html;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
  if (!persist) {
    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  }
}

function hideStatus() {
  statusEl.style.display = 'none';
}

function buildReport(): BugReport {
  return {
    title: bugTitle.value || 'Untitled Bug',
    stepsToReproduce: steps.value,
    expectedBehavior: expected.value,
    actualBehavior: actual.value,
    environment,
    consoleErrors: tabData.consoleErrors,
    failedRequests: tabData.failedRequests,
    screenshots: screenshots.length > 0 ? screenshots : undefined,
  };
}

// ── Screenshots ──
function renderScreenshots() {
  screenshotThumbs.innerHTML = '';
  screenshotCountEl.textContent = String(screenshots.length);
  screenshotCountEl.classList.toggle('has-items', screenshots.length > 0);

  screenshots.forEach((dataUrl, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'screenshot-thumb';
    thumb.title = 'Click to open full size';
    thumb.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.screenshot-remove')) return;
      chrome.tabs.create({ url: dataUrl });
    });

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = `Screenshot ${idx + 1}`;

    const indexBadge = document.createElement('span');
    indexBadge.className = 'screenshot-index';
    indexBadge.textContent = String(idx + 1);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'screenshot-remove';
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      screenshots.splice(idx, 1);
      renderScreenshots();
    });

    thumb.appendChild(img);
    thumb.appendChild(indexBadge);
    thumb.appendChild(remove);
    screenshotThumbs.appendChild(thumb);
  });
}

btnCapture.addEventListener('click', async () => {
  setButtonLoading(btnCapture, true);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
    if (dataUrl) {
      screenshots.push(dataUrl);
      renderScreenshots();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showStatus(`Capture failed: ${msg}`, 'error');
  } finally {
    setButtonLoading(btnCapture, false, '+ Capture');
  }
});

function setButtonLoading(btn: HTMLButtonElement, loading: boolean, idleText?: string) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.idleText = btn.textContent ?? '';
    btn.innerHTML = `<span class="spinner"></span> ${btn.dataset.idleText}`;
  } else {
    btn.textContent = idleText ?? btn.dataset.idleText ?? '';
  }
}

function populateSelect(
  select: HTMLSelectElement,
  items: { value: string; label: string }[],
  selectedValue: string | undefined,
  placeholder?: string
) {
  select.innerHTML = '';
  if (placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = placeholder;
    select.appendChild(opt);
  }
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    if (item.value === selectedValue) opt.selected = true;
    select.appendChild(opt);
  }
}

async function initJira() {
  const config = await getJiraConfig();
  console.log('[qassist] loaded config:', config);
  if (!config) {
    btnJira.textContent = 'Configure Jira';
    btnJira.dataset.action = 'configure';
    return;
  }

  jiraClient = new JiraClient(config);
  jiraAvailable = true;
  jiraPanel.style.display = 'block';
  console.log('[qassist] jiraClient created for domain:', config.domain);

  const lastSelections = await getLastSelections();

  try {
    console.log('[qassist] fetching projects and priorities...');
    const [projects, priorities] = await Promise.all([
      jiraClient.getProjects(),
      jiraClient.getPriorities().catch((e) => {
        console.warn('[qassist] getPriorities failed:', e);
        return [] as JiraPriority[];
      }),
    ]);
    console.log('[qassist] loaded', projects.length, 'projects,', priorities.length, 'priorities');

    if (projects.length === 0) {
      showStatus('No Jira projects available on your account.', 'error', true);
      jiraAvailable = false;
      return;
    }

    populateSelect(
      jiraProject,
      projects.map((p: JiraProject) => ({ value: p.key, label: `${p.name} (${p.key})` })),
      lastSelections.projectKey ?? config.defaultProject ?? projects[0].key
    );
    populateSelect(
      jiraPriority,
      priorities.map((p) => ({ value: p.id, label: p.name })),
      lastSelections.priorityId ?? config.defaultPriority,
      '— none —'
    );

    await loadIssueTypes(jiraProject.value, lastSelections.issueTypeId);

    jiraProject.addEventListener('change', () => {
      loadIssueTypes(jiraProject.value);
    });
  } catch (err) {
    if (err instanceof JiraNotLoggedInError) {
      const loginUrl = jiraClient.loginUrl();
      showStatus(
        `Not logged in to Jira. <a href="${loginUrl}" data-reload>Log in</a>, then reopen this popup.`,
        'info',
        true
      );
    } else {
      showStatus(`Jira: ${err instanceof Error ? err.message : String(err)}`, 'error', true);
    }
    jiraAvailable = false;
  }
}

async function loadIssueTypes(projectKey: string, preselectId?: string) {
  if (!jiraClient) return;
  jiraIssueType.disabled = true;
  jiraIssueType.innerHTML = '<option>Loading...</option>';
  try {
    const types = await jiraClient.getIssueTypes(projectKey);
    const selectable = types.filter((t) => !/sub-?task/i.test(t.name));
    populateSelect(
      jiraIssueType,
      selectable.map((t: JiraIssueType) => ({ value: t.id, label: t.name })),
      preselectId ?? selectable.find((t) => /bug/i.test(t.name))?.id ?? selectable[0]?.id
    );
  } catch (err) {
    jiraIssueType.innerHTML = '<option>(failed to load)</option>';
  } finally {
    jiraIssueType.disabled = false;
  }
}

// Heavy Jira-mode init: screenshot, env, tab data, Jira API.
// Only runs when the user actually selects Jira mode.
async function initJiraView() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    let viewportWidth = 0;
    let viewportHeight = 0;
    let devicePixelRatio = 1;
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        }),
      });
      if (result) {
        viewportWidth = result.viewportWidth;
        viewportHeight = result.viewportHeight;
        devicePixelRatio = result.devicePixelRatio;
      }
    } catch {
      // May fail on chrome:// pages
    }

    const ua = navigator.userAgent;
    const { browser, os } = parseUserAgent(ua);

    environment = {
      url: tab.url ?? '',
      title: tab.title ?? '',
      userAgent: ua,
      browser,
      os,
      viewportWidth,
      viewportHeight,
      devicePixelRatio,
    };

    envInfo.textContent = [
      `URL: ${environment.url}`,
      `Browser: ${environment.browser}`,
      `OS: ${environment.os}`,
      `Viewport: ${viewportWidth}x${viewportHeight} (${devicePixelRatio}x)`,
    ].join('\n');

    bugTitle.value = tab.title ?? '';

    tabData = await new Promise<TabData>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'get-tab-data', tabId: tab.id },
        (response) => {
          resolve(response?.data ?? { consoleErrors: [], failedRequests: [] });
        }
      );
    });

    if (tabData.consoleErrors.length > 0) {
      errorsSection.style.display = 'block';
      errorCount.textContent = String(tabData.consoleErrors.length);
      errorsList.textContent = tabData.consoleErrors
        .map((e) => `[${e.type}] ${e.message}`)
        .join('\n\n');

      if (!actual.value) {
        actual.value = tabData.consoleErrors[0].message;
      }
    }

    if (tabData.failedRequests.length > 0) {
      requestsSection.style.display = 'block';
      requestCount.textContent = String(tabData.failedRequests.length);
      requestsList.textContent = tabData.failedRequests
        .map((r) => {
          const status = r.statusCode ? `${r.statusCode}` : r.error ?? 'failed';
          return `${r.method} ${r.url} → ${status}`;
        })
        .join('\n');
    }

  } catch (e) {
    console.error('[qassist] init error:', e);
    showStatus(`Init error: ${e instanceof Error ? e.message : String(e)}`, 'error', true);
  }

  initJira()
    .catch((e) => {
      console.error('[qassist] initJira error:', e);
      showStatus(`Jira init error: ${e instanceof Error ? e.message : String(e)}`, 'error', true);
    })
    .finally(() => {
      jiraInitComplete = true;
    });
}

btnCopy.addEventListener('click', async () => {
  const report = buildReport();
  const markdown = formatAsMarkdown(report);
  try {
    await navigator.clipboard.writeText(markdown);
    showStatus('Copied to clipboard.', 'success');
  } catch {
    showStatus('Failed to copy to clipboard.', 'error');
  }
});

btnJira.addEventListener('click', async () => {
  console.log('[qassist] btnJira clicked', {
    action: btnJira.dataset.action,
    hasClient: !!jiraClient,
    jiraAvailable,
    jiraInitComplete,
    project: jiraProject.value,
    issueType: jiraIssueType.value,
  });

  if (btnJira.dataset.action === 'configure') {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (!jiraClient) {
    if (!jiraInitComplete) {
      showStatus('Still loading Jira, please wait...', 'info');
    } else {
      showStatus('Jira is not configured. Open Settings (⚙) to set it up.', 'error', true);
    }
    return;
  }

  if (!jiraAvailable) {
    showStatus('Jira is not available. Check the error message above or reopen the popup.', 'error', true);
    return;
  }

  const projectKey = jiraProject.value;
  const issueTypeId = jiraIssueType.value;
  const priorityId = jiraPriority.value || undefined;

  if (!projectKey || !issueTypeId) {
    showStatus('Select a project and issue type.', 'error');
    return;
  }

  if (!bugTitle.value.trim()) {
    showStatus('Enter a title for the issue.', 'error');
    bugTitle.focus();
    return;
  }

  hideStatus();
  setButtonLoading(btnJira, true);
  btnCopy.disabled = true;

  try {
    const report = buildReport();
    const issue = await jiraClient.createIssue({
      projectKey,
      issueTypeId,
      priorityId,
      summary: report.title,
      report,
    });

    // Attach any captured screenshots. Individual failures are non-fatal —
    // the issue itself is already created.
    for (let i = 0; i < screenshots.length; i++) {
      try {
        await jiraClient.attachScreenshot(issue.key, screenshots[i]);
      } catch (err) {
        console.warn(`Failed to attach screenshot ${i + 1}:`, err);
      }
    }

    await setLastSelections({ projectKey, issueTypeId, priorityId });

    const url = jiraClient.issueUrl(issue.key);
    showStatus(
      `Created <a href="${url}" target="_blank" rel="noopener">${issue.key}</a>`,
      'success',
      true
    );
  } catch (err) {
    if (err instanceof JiraNotLoggedInError) {
      const loginUrl = jiraClient.loginUrl();
      showStatus(
        `Not logged in. <a href="${loginUrl}">Log in to Jira</a>, then try again.`,
        'error',
        true
      );
    } else if (err instanceof JiraError) {
      const bodyMsg = extractJiraErrorMessage(err.body) || err.message;
      showStatus(`Jira error (${err.status}): ${bodyMsg}`, 'error', true);
    } else {
      showStatus(`Error: ${err instanceof Error ? err.message : String(err)}`, 'error', true);
    }
  } finally {
    setButtonLoading(btnJira, false, 'Create Jira Issue');
    btnCopy.disabled = false;
  }
});

function extractJiraErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.errorMessages) && b.errorMessages.length > 0) {
    return String(b.errorMessages[0]);
  }
  if (b.errors && typeof b.errors === 'object') {
    const errs = Object.entries(b.errors as Record<string, string>);
    if (errs.length > 0) return `${errs[0][0]}: ${errs[0][1]}`;
  }
  return null;
}

btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

statusEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'A') {
    e.preventDefault();
    const href = (target as HTMLAnchorElement).href;
    chrome.tabs.create({ url: href });
  }
});

// ── User generator logic ──
const USERGEN_FIELDS: { key: keyof FakeUser; label: string }[] = [
  { key: 'fullName', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'street', label: 'Street' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'zip', label: 'ZIP' },
  { key: 'country', label: 'Country' },
];

function showUsergenStatus(text: string, type: 'success' | 'error' | 'info') {
  usergenStatus.textContent = text;
  usergenStatus.className = `status ${type}`;
  usergenStatus.style.display = 'block';
  setTimeout(() => { usergenStatus.style.display = 'none'; }, 3000);
}

function renderUser(user: FakeUser) {
  usergenResults.innerHTML = '';
  for (const { key, label } of USERGEN_FIELDS) {
    const value = String(user[key] ?? '');
    if (!value) continue;

    const row = document.createElement('div');
    row.className = 'usergen-row';

    const labelEl = document.createElement('div');
    labelEl.className = 'usergen-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'usergen-value';
    valueEl.textContent = value;

    const btn = document.createElement('button');
    btn.className = 'usergen-copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1200);
      } catch {
        showUsergenStatus('Failed to copy.', 'error');
      }
    });

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    row.appendChild(btn);
    usergenResults.appendChild(row);
  }
}

btnUsergenGenerate.addEventListener('click', async () => {
  hideUsergenPlaceholder();
  setButtonLoading(btnUsergenGenerate, true);
  btnUsergenCopyAll.disabled = true;
  btnUsergenAutofill.disabled = true;
  btnUsergenAddToUsers.disabled = true;
  btnUsergenMailinator.disabled = true;
  try {
    const countryCode = usergenCountry.value || undefined;
    const user = await generateFakeUser({ countryCode });
    currentUser = user;
    renderUser(user);
    usergenResults.style.display = 'block';
    btnUsergenCopyAll.disabled = false;
    btnUsergenAutofill.disabled = false;
    btnUsergenAddToUsers.disabled = !user.email;
    btnUsergenMailinator.disabled = !user.email;
  } catch (e) {
    showUsergenStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  } finally {
    setButtonLoading(btnUsergenGenerate, false, 'Generate');
  }
});

btnUsergenCopyAll.addEventListener('click', async () => {
  if (!currentUser) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(currentUser, null, 2));
    showUsergenStatus('Copied JSON to clipboard.', 'success');
  } catch {
    showUsergenStatus('Failed to copy.', 'error');
  }
});

btnUsergenMailinator.addEventListener('click', async () => {
  if (!currentUser?.email) return;
  const url = `https://mailinator.com/v4/public/inboxes.jsp?to=${encodeURIComponent(currentUser.email)}`;
  await chrome.tabs.create({ url });
});

btnUsergenAutofill.addEventListener('click', async () => {
  if (!currentUser) return;
  setButtonLoading(btnUsergenAutofill, true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showUsergenStatus('No active tab.', 'error');
      return;
    }
    const payload: AutofillUserPayload = {
      firstName: currentUser.firstName,
      lastName: currentUser.lastName,
      fullName: currentUser.fullName,
      birthday: currentUser.birthday,
      phone: currentUser.phone,
      email: currentUser.email,
      street: currentUser.street,
      city: currentUser.city,
      state: currentUser.state,
      zip: currentUser.zip,
      country: currentUser.country,
      countryCode: currentUser.countryCode,
    };
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'autofill-user',
      user: payload,
    }) as { type: 'autofill-result'; result: AutofillResult } | undefined;

    const result = response?.result;
    if (!result) {
      showUsergenStatus('No response from page. Try reloading the tab.', 'error');
      return;
    }
    if (result.filled === 0) {
      showUsergenStatus('No matching fields found on this page.', 'info');
    } else {
      showUsergenStatus(`Filled ${result.filled} field${result.filled === 1 ? '' : 's'}.`, 'success');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Receiving end does not exist/i.test(msg)) {
      showUsergenStatus('Content script not loaded on this tab. Reload the page.', 'error');
    } else {
      showUsergenStatus(`Autofill failed: ${msg}`, 'error');
    }
  } finally {
    setButtonLoading(btnUsergenAutofill, false, 'Autofill page');
  }
});

btnUsergenAddToUsers.addEventListener('click', async () => {
  if (!currentUser?.email) return;
  setButtonLoading(btnUsergenAddToUsers, true);
  try {
    if (!usersInitStarted) {
      usersInitStarted = true;
      await initUsersView();
    }
    const now = new Date().toISOString();
    const newEntry: QaUser = {
      username: currentUser.email,
      environment: '',
      brand: '',
      notes: undefined,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    usersState = [newEntry, ...usersState];
    editingUserId = newEntry.id;
    usersFilter.value = '';
    usersEnvFilter.value = '';
    usersBrandFilter.value = '';
    renderUsers();
    showView('users');

    try {
      await saveUsers(usersState);
      hideDriveWarn(usersDriveWarn);
    } catch (err) {
      showDriveWarn(usersDriveWarn, driveErrorMessage(err));
    }
  } finally {
    setButtonLoading(btnUsergenAddToUsers, false, '+ Save to Users');
  }
});

function hideUsergenPlaceholder() {
  usergenPlaceholder.style.display = 'none';
}

// ── QA lists: Users + Strange Stuff ──

const usersList = document.getElementById('users-list') as HTMLDivElement;
const usersEmpty = document.getElementById('users-empty') as HTMLDivElement;
const usersFilter = document.getElementById('users-filter') as HTMLInputElement;
const usersEnvFilter = document.getElementById('users-env-filter') as HTMLSelectElement;
const usersBrandFilter = document.getElementById('users-brand-filter') as HTMLSelectElement;
const usersDriveWarn = document.getElementById('users-drive-warn') as HTMLDivElement;
const btnUsersAdd = document.getElementById('btn-users-add') as HTMLButtonElement;
const btnUsersCancel = document.getElementById('btn-users-cancel') as HTMLButtonElement;
const usersAddForm = document.getElementById('users-add-form') as HTMLFormElement;
const usersNewUsername = document.getElementById('users-new-username') as HTMLInputElement;
const usersNewEnv = document.getElementById('users-new-env') as HTMLSelectElement;
const usersNewBrand = document.getElementById('users-new-brand') as HTMLSelectElement;
const usersNewNotes = document.getElementById('users-new-notes') as HTMLInputElement;

const strangeList = document.getElementById('strange-list') as HTMLDivElement;
const strangeEmpty = document.getElementById('strange-empty') as HTMLDivElement;
const strangeFilter = document.getElementById('strange-filter') as HTMLInputElement;
const strangeDriveWarn = document.getElementById('strange-drive-warn') as HTMLDivElement;
const btnStrangeAdd = document.getElementById('btn-strange-add') as HTMLButtonElement;
const btnStrangeCancel = document.getElementById('btn-strange-cancel') as HTMLButtonElement;
const strangeAddForm = document.getElementById('strange-add-form') as HTMLFormElement;
const strangeNewTitle = document.getElementById('strange-new-title') as HTMLInputElement;
const strangeNewDescription = document.getElementById('strange-new-description') as HTMLTextAreaElement;

let usersState: QaUser[] = [];
let strangeState: QaStrangeEntry[] = [];
let editingUserId: string | null = null;
let expandedStrangeId: string | null = null;
let editingStrangeId: string | null = null;

function showDriveWarn(el: HTMLDivElement, message: string) {
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message + ' ';
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'Open Settings';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  el.appendChild(span);
  el.appendChild(link);
  el.className = 'status info';
  el.style.display = 'block';
}

function hideDriveWarn(el: HTMLDivElement) {
  el.style.display = 'none';
}

function syncFilterDropdown(
  select: HTMLSelectElement,
  values: string[],
  placeholder: string,
) {
  const wanted = ['', ...values];
  const existing = Array.from(select.options).map((o) => o.value);
  if (arraysEqual(existing, wanted)) return;
  const prior = select.value;
  select.innerHTML = '';
  const any = document.createElement('option');
  any.value = '';
  any.textContent = placeholder;
  select.appendChild(any);
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
  select.value = values.includes(prior) || prior === '' ? prior : '';
}

function renderUsers() {
  const filter = usersFilter.value.trim().toLowerCase();
  const envFilter = usersEnvFilter.value;
  const brandFilter = usersBrandFilter.value;

  const envs = Array.from(new Set(usersState.map((u) => u.environment).filter(Boolean))).sort();
  const brands = Array.from(new Set(usersState.map((u) => u.brand).filter(Boolean))).sort();
  syncFilterDropdown(usersEnvFilter, envs, 'All envs');
  syncFilterDropdown(usersBrandFilter, brands, 'All brands');
  syncFilterDropdown(usersNewEnv, envs, '— select —');
  syncFilterDropdown(usersNewBrand, brands, '— select —');

  const filtered = usersState
    .filter((u) => {
      if (envFilter && u.environment !== envFilter) return false;
      if (brandFilter && u.brand !== brandFilter) return false;
      if (!filter) return true;
      return (
        u.username.toLowerCase().includes(filter) ||
        (u.notes ?? '').toLowerCase().includes(filter)
      );
    })
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  usersList.innerHTML = '';
  usersEmpty.style.display = filtered.length === 0 ? 'block' : 'none';

  for (const u of filtered) {
    usersList.appendChild(renderUserItem(u, envs, brands));
  }
}

function renderUserItem(u: QaUser, envs: string[], brands: string[]): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'qa-item';
  const isEditing = editingUserId === u.id;
  if (isEditing) item.classList.add('editing');

  const summary = document.createElement('div');
  summary.className = 'qa-item-summary';
  summary.title = 'Click to edit';
  summary.addEventListener('click', () => {
    editingUserId = isEditing ? null : u.id;
    renderUsers();
  });

  const row = document.createElement('div');
  row.className = 'qa-item-row';

  const username = document.createElement('span');
  username.className = 'qa-username';
  username.textContent = u.username;
  row.appendChild(username);

  if (u.environment) {
    const chip = document.createElement('span');
    const envKey = u.environment.toLowerCase().replace(/\s+/g, '-');
    chip.className = `qa-chip env-${envKey}`;
    chip.textContent = u.environment;
    row.appendChild(chip);
  }
  if (u.brand) {
    const chip = document.createElement('span');
    chip.className = 'qa-chip';
    chip.textContent = u.brand;
    row.appendChild(chip);
  }

  summary.appendChild(row);

  if (u.notes) {
    const notes = document.createElement('div');
    notes.className = 'qa-notes';
    notes.textContent = u.notes;
    summary.appendChild(notes);
  }

  item.appendChild(summary);

  if (isEditing) item.appendChild(renderUserEditForm(u, envs, brands));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'qa-remove';
  remove.textContent = '×';
  remove.title = 'Delete';
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete ${u.username}?`)) return;
    usersState = usersState.filter((x) => x.id !== u.id);
    if (editingUserId === u.id) editingUserId = null;
    renderUsers();
    try {
      await saveUsers(usersState);
      hideDriveWarn(usersDriveWarn);
    } catch (err) {
      showDriveWarn(usersDriveWarn, driveErrorMessage(err));
    }
  });
  item.appendChild(remove);

  return item;
}

function addTextField(
  form: HTMLDivElement,
  id: string,
  key: string,
  label: string,
  value: string,
): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.htmlFor = `users-edit-${key}-${id}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = labelEl.htmlFor;
  input.autocomplete = 'off';
  input.value = value;
  row.appendChild(labelEl);
  row.appendChild(input);
  form.appendChild(row);
  return input;
}

function addSelectField(
  form: HTMLDivElement,
  id: string,
  key: string,
  label: string,
  value: string,
  options: string[],
): HTMLSelectElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const labelEl = document.createElement('label');
  labelEl.textContent = label;
  labelEl.htmlFor = `users-edit-${key}-${id}`;
  const select = document.createElement('select');
  select.id = labelEl.htmlFor;
  const choices = options.includes(value) || !value ? options : [...options, value];
  for (const opt of choices) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === value) o.selected = true;
    select.appendChild(o);
  }
  row.appendChild(labelEl);
  row.appendChild(select);
  form.appendChild(row);
  return select;
}

function renderUserEditForm(u: QaUser, envs: string[], brands: string[]): HTMLDivElement {
  const form = document.createElement('div');
  form.className = 'qa-edit';
  form.addEventListener('click', (e) => e.stopPropagation());

  const usernameInput = addTextField(form, u.id, 'username', 'Username', u.username);
  const envSelect = addSelectField(form, u.id, 'environment', 'Env', u.environment, envs);
  const brandSelect = addSelectField(form, u.id, 'brand', 'Brand', u.brand, brands);
  const notesInput = addTextField(form, u.id, 'notes', 'Notes', u.notes ?? '');

  const inputs = {
    username: usernameInput,
    environment: envSelect,
    brand: brandSelect,
    notes: notesInput,
  };

  const actions = document.createElement('div');
  actions.className = 'qa-edit-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    editingUserId = null;
    renderUsers();
  });

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-secondary';
  copyBtn.textContent = 'Copy user';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inputs.username.value);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy user'; }, 900);
    } catch { /* noop */ }
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const username = inputs.username.value.trim();
    if (!username) { inputs.username.focus(); return; }
    const updated: QaUser = {
      ...u,
      username,
      environment: inputs.environment.value.trim(),
      brand: inputs.brand.value.trim(),
      notes: inputs.notes.value.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    usersState = usersState.map((x) => (x.id === u.id ? updated : x));
    editingUserId = null;
    renderUsers();
    try {
      await saveUsers(usersState);
      hideDriveWarn(usersDriveWarn);
    } catch (err) {
      showDriveWarn(usersDriveWarn, driveErrorMessage(err));
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  return form;
}

function renderStrange() {
  const filter = strangeFilter.value.toLowerCase();
  const filtered = strangeState.filter((e) => {
    if (!filter) return true;
    return e.title.toLowerCase().includes(filter) || e.description.toLowerCase().includes(filter);
  });

  strangeList.innerHTML = '';
  strangeEmpty.style.display = filtered.length === 0 ? 'block' : 'none';

  for (const e of filtered) {
    strangeList.appendChild(renderStrangeItem(e));
  }
}

function renderStrangeItem(e: QaStrangeEntry): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'qa-item';
  const isExpanded = expandedStrangeId === e.id;
  const isEditing = editingStrangeId === e.id;
  if (isExpanded || isEditing) item.classList.add('expanded');
  if (isEditing) item.classList.add('editing');

  const title = document.createElement('div');
  title.className = 'qa-strange-title';
  title.textContent = e.title;
  title.title = 'Click to expand';
  title.addEventListener('click', () => {
    if (isEditing) return;
    expandedStrangeId = isExpanded ? null : e.id;
    renderStrange();
  });
  item.appendChild(title);

  if (isEditing) {
    item.appendChild(renderStrangeEditForm(e));
  } else {
    const desc = document.createElement('div');
    desc.className = 'qa-strange-desc';
    desc.textContent = e.description;
    item.appendChild(desc);

    if (isExpanded) {
      const actions = document.createElement('div');
      actions.className = 'qa-edit-actions';
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-secondary';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        editingStrangeId = e.id;
        renderStrange();
      });
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try {
          await navigator.clipboard.writeText(e.description);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 900);
        } catch { /* noop */ }
      });
      actions.appendChild(copyBtn);
      actions.appendChild(editBtn);
      item.appendChild(actions);
    }
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'qa-remove';
  remove.textContent = '×';
  remove.title = 'Delete';
  remove.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!confirm(`Delete "${e.title}"?`)) return;
    strangeState = strangeState.filter((x) => x.id !== e.id);
    if (expandedStrangeId === e.id) expandedStrangeId = null;
    if (editingStrangeId === e.id) editingStrangeId = null;
    renderStrange();
    try {
      await saveStrangeStuff(strangeState);
      hideDriveWarn(strangeDriveWarn);
    } catch (err) {
      showDriveWarn(strangeDriveWarn, driveErrorMessage(err));
    }
  });
  item.appendChild(remove);

  return item;
}

function renderStrangeEditForm(e: QaStrangeEntry): HTMLDivElement {
  const form = document.createElement('div');
  form.className = 'qa-edit';
  form.addEventListener('click', (ev) => ev.stopPropagation());

  const titleRow = document.createElement('div');
  titleRow.className = 'field-row';
  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title';
  titleLabel.htmlFor = `strange-edit-title-${e.id}`;
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.id = titleLabel.htmlFor;
  titleInput.autocomplete = 'off';
  titleInput.value = e.title;
  titleRow.appendChild(titleLabel);
  titleRow.appendChild(titleInput);
  form.appendChild(titleRow);

  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  descLabel.htmlFor = `strange-edit-desc-${e.id}`;
  descLabel.style.fontSize = '11px';
  descLabel.style.color = 'var(--text-label)';
  const descInput = document.createElement('textarea');
  descInput.id = descLabel.htmlFor;
  descInput.rows = 6;
  descInput.value = e.description;
  form.appendChild(descLabel);
  form.appendChild(descInput);

  const actions = document.createElement('div');
  actions.className = 'qa-edit-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    editingStrangeId = null;
    renderStrange();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return; }
    const updated: QaStrangeEntry = {
      ...e,
      title,
      description: descInput.value,
      updatedAt: new Date().toISOString(),
    };
    strangeState = strangeState.map((x) => (x.id === e.id ? updated : x));
    editingStrangeId = null;
    renderStrange();
    try {
      await saveStrangeStuff(strangeState);
      hideDriveWarn(strangeDriveWarn);
    } catch (err) {
      showDriveWarn(strangeDriveWarn, driveErrorMessage(err));
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  return form;
}

function driveErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not configured/i.test(msg)) {
    return 'Google Drive is not set up. Changes are saved locally only.';
  }
  return `Drive sync failed: ${msg}. Changes saved locally.`;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function initUsersView() {
  const { items } = await loadUsers();
  usersState = items;
  renderUsers();
}

async function initStrangeView() {
  const { items } = await loadStrangeStuff();
  strangeState = items;
  renderStrange();
}

usersFilter.addEventListener('input', renderUsers);
usersEnvFilter.addEventListener('change', renderUsers);
usersBrandFilter.addEventListener('change', renderUsers);
strangeFilter.addEventListener('input', renderStrange);

// ── Add-entry forms ──
btnUsersAdd.addEventListener('click', () => {
  usersAddForm.style.display = 'block';
  usersNewUsername.focus();
});
btnUsersCancel.addEventListener('click', () => {
  usersAddForm.style.display = 'none';
  usersAddForm.reset();
});
usersAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = usersNewUsername.value.trim();
  if (!username) { usersNewUsername.focus(); return; }
  const now = new Date().toISOString();
  const newEntry: QaUser = {
    username,
    environment: usersNewEnv.value.trim(),
    brand: usersNewBrand.value.trim(),
    notes: usersNewNotes.value.trim() || undefined,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  usersState = [newEntry, ...usersState];
  renderUsers();
  usersAddForm.style.display = 'none';
  usersAddForm.reset();
  try {
    await saveUsers(usersState);
    hideDriveWarn(usersDriveWarn);
  } catch (err) {
    showDriveWarn(usersDriveWarn, driveErrorMessage(err));
  }
});

btnStrangeAdd.addEventListener('click', () => {
  strangeAddForm.style.display = 'block';
  strangeNewTitle.focus();
});
btnStrangeCancel.addEventListener('click', () => {
  strangeAddForm.style.display = 'none';
  strangeAddForm.reset();
});
strangeAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = strangeNewTitle.value.trim();
  if (!title) { strangeNewTitle.focus(); return; }
  const now = new Date().toISOString();
  const newEntry: QaStrangeEntry = {
    title,
    description: strangeNewDescription.value,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
  strangeState = [newEntry, ...strangeState];
  renderStrange();
  strangeAddForm.style.display = 'none';
  strangeAddForm.reset();
  try {
    await saveStrangeStuff(strangeState);
    hideDriveWarn(strangeDriveWarn);
  } catch (err) {
    showDriveWarn(strangeDriveWarn, driveErrorMessage(err));
  }
});

// React to background refreshes pulled from Drive
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[CACHE_KEYS.users]) {
    const next = changes[CACHE_KEYS.users].newValue;
    if (Array.isArray(next)) {
      usersState = next as QaUser[];
      if (usersInitStarted) renderUsers();
    }
  }
  if (changes[CACHE_KEYS.strange]) {
    const next = changes[CACHE_KEYS.strange].newValue;
    if (Array.isArray(next)) {
      strangeState = next as QaStrangeEntry[];
      if (strangeInitStarted) renderStrange();
    }
  }
});

// ── Start on picker ──
showView('picker');
