import type { BugReport, EnvironmentInfo, TabData } from '../lib/types.js';
import { formatAsMarkdown } from '../lib/formatter.js';
import { JiraClient, JiraError, JiraNotLoggedInError, type JiraProject, type JiraIssueType, type JiraPriority } from '../lib/jira-client.js';
import { getJiraConfig, getLastSelections, setLastSelections } from '../lib/storage.js';

// DOM elements
const screenshotPreview = document.getElementById('screenshot-preview') as HTMLImageElement;
const includeScreenshot = document.getElementById('include-screenshot') as HTMLInputElement;
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
const btnOptions = document.getElementById('btn-options') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

let screenshotDataUrl: string | undefined;
let environment: EnvironmentInfo;
let tabData: TabData = { consoleErrors: [], failedRequests: [] };
let jiraClient: JiraClient | null = null;
let jiraAvailable = false;
let jiraInitComplete = false;

// Toggle collapsible sections
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
    screenshotDataUrl: includeScreenshot.checked ? screenshotDataUrl : undefined,
  };
}

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
    // Fetch projects and priorities in parallel
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

    // Load issue types for the selected project
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
    // Exclude subtasks from top-level options — they require a parent
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

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Capture screenshot
    try {
      screenshotDataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      if (screenshotDataUrl) screenshotPreview.src = screenshotDataUrl;
    } catch {
      screenshotPreview.alt = 'Screenshot unavailable';
    }

    // Collect viewport info from the page
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

    // Request captured errors and failed requests from service worker
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

  // Initialize Jira in the background — don't block the UI on it
  initJira()
    .catch((e) => {
      console.error('[qassist] initJira error:', e);
      showStatus(`Jira init error: ${e instanceof Error ? e.message : String(e)}`, 'error', true);
    })
    .finally(() => {
      jiraInitComplete = true;
    });
}

// Copy to clipboard
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

// Create Jira issue
btnJira.addEventListener('click', async () => {
  console.log('[qassist] btnJira clicked', {
    action: btnJira.dataset.action,
    hasClient: !!jiraClient,
    jiraAvailable,
    jiraInitComplete,
    project: jiraProject.value,
    issueType: jiraIssueType.value,
  });

  // If Jira not configured, open options
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

    // Attach screenshot if included — failure here is non-fatal
    if (includeScreenshot.checked && screenshotDataUrl) {
      try {
        await jiraClient.attachScreenshot(issue.key, screenshotDataUrl);
      } catch (err) {
        console.warn('Failed to attach screenshot:', err);
      }
    }

    // Persist selections for next time
    await setLastSelections({ projectKey, issueTypeId, priorityId });

    const url = jiraClient.issueUrl(issue.key);
    showStatus(
      `Created <a href="${url}" target="_blank" rel="noopener">${issue.key}</a>`,
      'success',
      true
    );

    // Wire up link click to open in new tab (since popup anchor target="_blank" works)
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

// Open options page
btnOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Intercept links in status (needed because popup anchors behave oddly)
statusEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'A') {
    e.preventDefault();
    const href = (target as HTMLAnchorElement).href;
    chrome.tabs.create({ url: href });
  }
});

init();
