// Thin wrapper around chrome.identity for Google OAuth.
// Uses the currently signed-in Chrome account — no password re-entry.
// Requires manifest.oauth2.client_id to be set to a real Chrome-extension
// OAuth client (see docs/SETUP.md).

const PLACEHOLDER_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

export class GoogleAuthNotConfiguredError extends Error {
  constructor() {
    super('Google OAuth is not configured. Set manifest.oauth2.client_id.');
    this.name = 'GoogleAuthNotConfiguredError';
  }
}

export function isOAuthConfigured(): boolean {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3 & {
    oauth2?: { client_id?: string };
  };
  const cid = manifest.oauth2?.client_id;
  return typeof cid === 'string' && cid.length > 0 && cid !== PLACEHOLDER_CLIENT_ID;
}

export async function getAccessToken(interactive: boolean): Promise<string> {
  if (!isOAuthConfigured()) throw new GoogleAuthNotConfiguredError();
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'No token'));
        return;
      }
      resolve(typeof token === 'string' ? token : (token as { token: string }).token);
    });
  });
}

export async function revokeToken(): Promise<void> {
  let token: string;
  try {
    token = await getAccessToken(false);
  } catch {
    return; // already signed out
  }
  // Remove the cached token
  await new Promise<void>((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
  // Revoke at Google so the next interactive call re-prompts for scopes.
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    });
  } catch {
    // Non-fatal — local cache is already cleared.
  }
}

export async function getConnectedEmail(): Promise<string | null> {
  let token: string;
  try {
    token = await getAccessToken(false);
  } catch {
    return null;
  }
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return typeof data.email === 'string' ? data.email : null;
  } catch {
    return null;
  }
}
