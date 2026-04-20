// Theme loading + application. Shared by the side-panel UI and options page.

export type Theme = 'light' | 'dark-amber';

const THEME_KEY = 'theme';
export const DEFAULT_THEME: Theme = 'light';

export async function getTheme(): Promise<Theme> {
  const result = await chrome.storage.local.get(THEME_KEY);
  const value = result[THEME_KEY];
  return value === 'dark-amber' || value === 'light' ? value : DEFAULT_THEME;
}

export async function setTheme(theme: Theme): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: theme });
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

// Apply the stored theme now and keep the page in sync if the user changes
// themes elsewhere (e.g. options page updating the side panel live).
export async function initTheme(): Promise<Theme> {
  const theme = await getTheme();
  applyTheme(theme);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[THEME_KEY];
    if (!change) return;
    const next = change.newValue;
    if (next === 'light' || next === 'dark-amber') applyTheme(next);
  });

  return theme;
}
