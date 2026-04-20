// Minimal Google Drive v3 REST wrapper.
// Scope: drive.file — we can only see files created by this extension
// (or explicitly opened via a picker, which we don't use). We never touch
// anything else in the user's Drive.

import { getAccessToken } from './google-auth.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'DriveError';
  }
}

async function driveFetch(url: string, init: RequestInit = {}, retryOn401 = true): Promise<Response> {
  const token = await getAccessToken(false);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const resp = await fetch(url, { ...init, headers });
  if (resp.status === 401 && retryOn401) {
    // Token may be stale; remove it and try once more interactively.
    await new Promise<void>((r) => chrome.identity.removeCachedAuthToken({ token }, () => r()));
    return driveFetch(url, init, false);
  }
  return resp;
}

async function parseErrorBody(resp: Response): Promise<unknown> {
  try {
    return await resp.json();
  } catch {
    return undefined;
  }
}

// Search for a folder with the given name in the user's Drive root that this
// extension can see. Creates one if none exists.
export async function ensureFolder(name: string): Promise<string> {
  // drive.file only returns files this app created/opened, which is what we want.
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const searchResp = await driveFetch(`${API}/files?q=${q}&fields=files(id,name)`);
  if (!searchResp.ok) {
    throw new DriveError(searchResp.status, 'Drive folder search failed', await parseErrorBody(searchResp));
  }
  const { files } = (await searchResp.json()) as { files: { id: string; name: string }[] };
  if (files.length > 0) return files[0].id;

  const createResp = await driveFetch(`${API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  if (!createResp.ok) {
    throw new DriveError(createResp.status, 'Drive folder create failed', await parseErrorBody(createResp));
  }
  const { id } = (await createResp.json()) as { id: string };
  return id;
}

async function findFileInFolder(folderId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`
  );
  const resp = await driveFetch(`${API}/files?q=${q}&fields=files(id,name)`);
  if (!resp.ok) {
    throw new DriveError(resp.status, 'Drive file search failed', await parseErrorBody(resp));
  }
  const { files } = (await resp.json()) as { files: { id: string; name: string }[] };
  return files[0]?.id ?? null;
}

export async function readJsonFile<T = unknown>(fileId: string): Promise<T> {
  const resp = await driveFetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
  if (!resp.ok) {
    throw new DriveError(resp.status, 'Drive file read failed', await parseErrorBody(resp));
  }
  return (await resp.json()) as T;
}

export async function writeJsonFile(fileId: string, data: unknown): Promise<void> {
  const resp = await driveFetch(
    `${UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  if (!resp.ok) {
    throw new DriveError(resp.status, 'Drive file write failed', await parseErrorBody(resp));
  }
}

// Creates a JSON file inside the given folder with the given seed content.
// Uses multipart upload so the metadata (name + parent) and body go together.
async function createJsonFile(folderId: string, name: string, seed: unknown): Promise<string> {
  const boundary = `qassist-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, parents: [folderId], mimeType: 'application/json' };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(seed)}\r\n` +
    `--${boundary}--`;

  const resp = await driveFetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!resp.ok) {
    throw new DriveError(resp.status, 'Drive file create failed', await parseErrorBody(resp));
  }
  const { id } = (await resp.json()) as { id: string };
  return id;
}

// Returns the file's id and contents. Creates the file (populated with seed)
// if it doesn't already exist in the folder.
export async function ensureJsonFile<T>(
  folderId: string,
  name: string,
  seed: T,
): Promise<{ id: string; content: T }> {
  const existingId = await findFileInFolder(folderId, name);
  if (existingId) {
    const content = await readJsonFile<T>(existingId);
    return { id: existingId, content };
  }
  const newId = await createJsonFile(folderId, name, seed);
  return { id: newId, content: seed };
}
