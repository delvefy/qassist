import { JiraClient, JiraError, JiraNotLoggedInError } from '../lib/jira-client.js';
import { getJiraConfig, setJiraConfig, clearJiraConfig } from '../lib/storage.js';
import { initTheme, setTheme, type Theme } from '../lib/theme.js';
import {
  getAccessToken,
  getConnectedEmail,
  isOAuthConfigured,
  revokeToken,
} from '../lib/google-auth.js';
import { clearDriveHandles, resolveDriveHandles } from '../lib/qa-lists.js';

const form = document.getElementById('jira-form') as HTMLFormElement;
const domainInput = document.getElementById('domain') as HTMLInputElement;
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const btnClear = document.getElementById('btn-clear') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const userInfoCard = document.getElementById('user-info-card') as HTMLDivElement;
const userInfoEl = document.getElementById('user-info') as HTMLParagraphElement;

function showStatus(html: string, type: 'success' | 'error' | 'info') {
  statusEl.innerHTML = html;
  statusEl.className = `status ${type}`;
  statusEl.style.display = 'block';
}

function hideStatus() {
  statusEl.style.display = 'none';
}

function normalizeDomain(input: string): string {
  return input.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
}

async function loadExistingConfig() {
  const config = await getJiraConfig();
  if (config) {
    domainInput.value = config.domain;

    // Validate the session is active
    try {
      const client = new JiraClient(config);
      const me = await client.validateCredentials();
      userInfoCard.style.display = 'block';
      userInfoEl.textContent = `${me.displayName}${me.emailAddress ? ` (${me.emailAddress})` : ''}`;
    } catch (err) {
      if (err instanceof JiraNotLoggedInError) {
        showStatus(
          `Not logged in to Jira. <a href="https://${config.domain}/login" target="_blank" rel="noopener">Log in to ${config.domain}</a>, then reload this page.`,
          'info'
        );
      } else {
        showStatus(`Could not reach Jira: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideStatus();
  btnSave.disabled = true;
  btnSave.textContent = 'Testing...';

  const domain = normalizeDomain(domainInput.value);
  const config = { domain };

  try {
    const client = new JiraClient(config);
    const me = await client.validateCredentials();
    await setJiraConfig(config);
    showStatus(`Connected as ${me.displayName}. Settings saved.`, 'success');
    userInfoCard.style.display = 'block';
    userInfoEl.textContent = `${me.displayName}${me.emailAddress ? ` (${me.emailAddress})` : ''}`;
  } catch (err) {
    if (err instanceof JiraNotLoggedInError) {
      showStatus(
        `Not logged in. Please <a href="https://${domain}/login" target="_blank" rel="noopener">log in to ${domain}</a>, then come back here and click Save & Test.`,
        'error'
      );
    } else if (err instanceof JiraError && err.status === 404) {
      showStatus('Domain not found. Check the Jira domain.', 'error');
    } else {
      showStatus(`Connection failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Save & Test';
  }
});

btnClear.addEventListener('click', async () => {
  await clearJiraConfig();
  domainInput.value = '';
  userInfoCard.style.display = 'none';
  showStatus('Settings cleared.', 'info');
});

// Intercept links in status
statusEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'A') {
    e.preventDefault();
    window.open((target as HTMLAnchorElement).href, '_blank');
  }
});

// ── Theme picker ──
const themeRadios = document.querySelectorAll<HTMLInputElement>('input[name="theme"]');

async function initThemePicker() {
  const current = await initTheme();
  for (const radio of themeRadios) {
    if (radio.value === current) radio.checked = true;
    radio.addEventListener('change', async () => {
      if (radio.checked) {
        await setTheme(radio.value as Theme);
      }
    });
  }
}

// ── Drive panel ──
const driveSetupNeeded = document.getElementById('drive-setup-needed') as HTMLDivElement;
const driveConnectPanel = document.getElementById('drive-connect-panel') as HTMLDivElement;
const driveStatusLine = document.getElementById('drive-status-line') as HTMLParagraphElement;
const btnDriveConnect = document.getElementById('btn-drive-connect') as HTMLButtonElement;
const btnDriveDisconnect = document.getElementById('btn-drive-disconnect') as HTMLButtonElement;
const driveStatus = document.getElementById('drive-status') as HTMLDivElement;

function showDriveStatus(text: string, type: 'success' | 'error' | 'info') {
  driveStatus.textContent = text;
  driveStatus.className = `status ${type}`;
  driveStatus.style.display = 'block';
}

function hideDriveStatus() {
  driveStatus.style.display = 'none';
}

async function renderDriveState() {
  if (!isOAuthConfigured()) {
    driveSetupNeeded.style.display = 'block';
    driveConnectPanel.style.display = 'none';
    return;
  }
  driveSetupNeeded.style.display = 'none';
  driveConnectPanel.style.display = 'block';

  const email = await getConnectedEmail();
  if (email) {
    driveStatusLine.textContent = `Connected as ${email}.`;
    btnDriveConnect.style.display = 'none';
    btnDriveDisconnect.style.display = 'inline-flex';
  } else {
    driveStatusLine.textContent = 'Not connected.';
    btnDriveConnect.style.display = 'inline-flex';
    btnDriveDisconnect.style.display = 'none';
  }
}

btnDriveConnect.addEventListener('click', async () => {
  hideDriveStatus();
  btnDriveConnect.disabled = true;
  const idle = btnDriveConnect.textContent;
  btnDriveConnect.textContent = 'Connecting…';
  try {
    await getAccessToken(true);
    // Seed/load the Drive folder+files so the first list view is instant.
    await resolveDriveHandles();
    showDriveStatus('Connected. Drive folder "qassist" is ready.', 'success');
    await renderDriveState();
  } catch (err) {
    showDriveStatus(`Connect failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    btnDriveConnect.disabled = false;
    if (idle) btnDriveConnect.textContent = idle;
  }
});

btnDriveDisconnect.addEventListener('click', async () => {
  hideDriveStatus();
  btnDriveDisconnect.disabled = true;
  try {
    await revokeToken();
    await clearDriveHandles();
    showDriveStatus('Disconnected.', 'info');
    await renderDriveState();
  } catch (err) {
    showDriveStatus(`Disconnect failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    btnDriveDisconnect.disabled = false;
  }
});

initThemePicker();
renderDriveState();
loadExistingConfig();
