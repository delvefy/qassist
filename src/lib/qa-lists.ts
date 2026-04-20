// High-level API for the two QA reference lists (users + strange stuff).
// Caches to chrome.storage.local for instant UI render, syncs through Drive.
// Debounces Drive writes so rapid edits collapse into one API call.

import { ensureFolder, ensureJsonFile, writeJsonFile } from './drive-client.js';
import seedUsers from '../data/seed-qaUsers.json';
import seedStrange from '../data/seed-qaStrangeStuff.json';

const DRIVE_FOLDER = 'qassist';
const USERS_FILE = 'qaUsers.json';
const STRANGE_FILE = 'qaStrangeStuff.json';

const CACHE_KEY_USERS = 'qaUsersCache';
const CACHE_KEY_STRANGE = 'qaStrangeCache';
const FILE_ID_KEY_USERS = 'qaUsersFileId';
const FILE_ID_KEY_STRANGE = 'qaStrangeFileId';
const FOLDER_ID_KEY = 'qassistFolderId';

export interface QaUser {
  username: string;
  environment: string;
  brand: string;
  notes?: string;
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface QaStrangeEntry {
  title: string;
  description: string;
  id: string;
  createdAt: string;
  updatedAt: string;
}

// ── Id helper: matches format of existing seed ids ──
export function generateId(): string {
  const ts = Date.now();
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${ts}_${suffix}`;
}

// ── Cache layer ──
async function readCache<T>(key: string): Promise<T | null> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T) ?? null;
}

async function writeCache<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// ── Drive sync ──
interface ListHandles {
  folderId: string;
  usersFileId: string;
  strangeFileId: string;
}

let handlesPromise: Promise<ListHandles> | null = null;

// Resolve the folder + file ids, seeding Drive with bundled data if missing.
// Cached in chrome.storage.local (and in-memory for this session) so
// subsequent calls are free.
export async function resolveDriveHandles(): Promise<ListHandles> {
  if (handlesPromise) return handlesPromise;
  handlesPromise = (async () => {
    const [storedFolder, storedUsers, storedStrange] = await Promise.all([
      readCache<string>(FOLDER_ID_KEY),
      readCache<string>(FILE_ID_KEY_USERS),
      readCache<string>(FILE_ID_KEY_STRANGE),
    ]);
    if (storedFolder && storedUsers && storedStrange) {
      return { folderId: storedFolder, usersFileId: storedUsers, strangeFileId: storedStrange };
    }
    const folderId = storedFolder ?? (await ensureFolder(DRIVE_FOLDER));
    const [usersResult, strangeResult] = await Promise.all([
      ensureJsonFile<QaUser[]>(folderId, USERS_FILE, seedUsers as QaUser[]),
      ensureJsonFile<QaStrangeEntry[]>(folderId, STRANGE_FILE, seedStrange as QaStrangeEntry[]),
    ]);
    await Promise.all([
      writeCache(FOLDER_ID_KEY, folderId),
      writeCache(FILE_ID_KEY_USERS, usersResult.id),
      writeCache(FILE_ID_KEY_STRANGE, strangeResult.id),
      writeCache(CACHE_KEY_USERS, usersResult.content),
      writeCache(CACHE_KEY_STRANGE, strangeResult.content),
    ]);
    return { folderId, usersFileId: usersResult.id, strangeFileId: strangeResult.id };
  })();
  try {
    return await handlesPromise;
  } catch (err) {
    handlesPromise = null; // allow retry
    throw err;
  }
}

// Reset cached handles — use after sign-out.
export async function clearDriveHandles(): Promise<void> {
  handlesPromise = null;
  await chrome.storage.local.remove([FOLDER_ID_KEY, FILE_ID_KEY_USERS, FILE_ID_KEY_STRANGE]);
}

// ── Public list API ──
export interface LoadResult<T> {
  items: T[];
  fromCache: boolean;
}

// Returns cached data immediately (or empty if none), then triggers a
// background refresh from Drive. When Drive returns, the cache is updated
// and a chrome.storage.onChanged event fires; views subscribe to that to
// re-render with fresh data.
export async function loadUsers(): Promise<LoadResult<QaUser>> {
  const cached = (await readCache<QaUser[]>(CACHE_KEY_USERS)) ?? [];
  refreshFromDrive('users').catch((err) => console.warn('[qassist] users refresh failed:', err));
  return { items: cached, fromCache: true };
}

export async function loadStrangeStuff(): Promise<LoadResult<QaStrangeEntry>> {
  const cached = (await readCache<QaStrangeEntry[]>(CACHE_KEY_STRANGE)) ?? [];
  refreshFromDrive('strange').catch((err) => console.warn('[qassist] strange refresh failed:', err));
  return { items: cached, fromCache: true };
}

async function refreshFromDrive(which: 'users' | 'strange'): Promise<void> {
  const handles = await resolveDriveHandles();
  const fileId = which === 'users' ? handles.usersFileId : handles.strangeFileId;
  const cacheKey = which === 'users' ? CACHE_KEY_USERS : CACHE_KEY_STRANGE;
  const { readJsonFile } = await import('./drive-client.js');
  const content = await readJsonFile(fileId);
  // If a local write is queued or in flight, our cache is ahead of Drive —
  // don't clobber it with stale data (the pending upload will make Drive catch up).
  if (pendingPayloads.has(which) || inFlightWrites.has(which)) return;
  await writeCache(cacheKey, content);
}

// ── Save API ──
// Writes local cache immediately; debounces the Drive upload.
const WRITE_DEBOUNCE_MS = 500;

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPayloads = new Map<string, unknown>();
const inFlightWrites = new Set<string>();

function scheduleDriveWrite(which: 'users' | 'strange', payload: unknown): Promise<void> {
  pendingPayloads.set(which, payload);
  const existing = pendingWrites.get(which);
  if (existing) clearTimeout(existing);
  return new Promise((resolve, reject) => {
    const t = setTimeout(async () => {
      pendingWrites.delete(which);
      const data = pendingPayloads.get(which);
      pendingPayloads.delete(which);
      inFlightWrites.add(which);
      try {
        const handles = await resolveDriveHandles();
        const fileId = which === 'users' ? handles.usersFileId : handles.strangeFileId;
        await writeJsonFile(fileId, data);
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        inFlightWrites.delete(which);
      }
    }, WRITE_DEBOUNCE_MS);
    pendingWrites.set(which, t);
  });
}

export async function saveUsers(users: QaUser[]): Promise<void> {
  await writeCache(CACHE_KEY_USERS, users);
  await scheduleDriveWrite('users', users);
}

export async function saveStrangeStuff(entries: QaStrangeEntry[]): Promise<void> {
  await writeCache(CACHE_KEY_STRANGE, entries);
  await scheduleDriveWrite('strange', entries);
}

// Surface cache keys so UI can subscribe to chrome.storage.onChanged.
export const CACHE_KEYS = {
  users: CACHE_KEY_USERS,
  strange: CACHE_KEY_STRANGE,
} as const;
