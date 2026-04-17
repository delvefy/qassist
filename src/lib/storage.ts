import type { JiraConfig } from './types.js';

const JIRA_CONFIG_KEY = 'jiraConfig';
const LAST_SELECTIONS_KEY = 'lastSelections';
const USERGEN_COUNTRY_KEY = 'usergenCountry';

export interface LastSelections {
  projectKey?: string;
  issueTypeId?: string;
  priorityId?: string;
}

export async function getJiraConfig(): Promise<JiraConfig | null> {
  const result = await chrome.storage.local.get(JIRA_CONFIG_KEY);
  return (result[JIRA_CONFIG_KEY] as JiraConfig) ?? null;
}

export async function setJiraConfig(config: JiraConfig): Promise<void> {
  await chrome.storage.local.set({ [JIRA_CONFIG_KEY]: config });
}

export async function clearJiraConfig(): Promise<void> {
  await chrome.storage.local.remove(JIRA_CONFIG_KEY);
}

export async function getLastSelections(): Promise<LastSelections> {
  const result = await chrome.storage.local.get(LAST_SELECTIONS_KEY);
  return (result[LAST_SELECTIONS_KEY] as LastSelections) ?? {};
}

export async function setLastSelections(selections: LastSelections): Promise<void> {
  await chrome.storage.local.set({ [LAST_SELECTIONS_KEY]: selections });
}

// User-generator country selection. Empty string means "Any country".
export async function getUsergenCountry(): Promise<string> {
  const result = await chrome.storage.local.get(USERGEN_COUNTRY_KEY);
  const value = result[USERGEN_COUNTRY_KEY];
  return typeof value === 'string' ? value : '';
}

export async function setUsergenCountry(countryCode: string): Promise<void> {
  await chrome.storage.local.set({ [USERGEN_COUNTRY_KEY]: countryCode });
}
