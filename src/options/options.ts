import { JiraClient, JiraError, JiraNotLoggedInError } from '../lib/jira-client.js';
import { getJiraConfig, setJiraConfig, clearJiraConfig } from '../lib/storage.js';

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

loadExistingConfig();
