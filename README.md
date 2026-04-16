# qassist

A personal Chrome extension for web QA — captures page context (console errors, failed network requests, screenshot, environment info) and files bugs directly to Jira Cloud using your existing browser session.

## Features

- **One-click bug capture** — screenshot, environment info (browser, OS, viewport, URL), console errors, failed network requests
- **Markdown export** — copy a pre-formatted bug report to the clipboard for any tracker
- **Jira Cloud integration** — create issues with project/type/priority selectors, screenshot attached automatically
- **Browser session auth** — no API token needed; uses your existing Jira cookies
- **Passive monitoring** — errors and failed requests are captured in the background, ready whenever you hit the icon

## Installation

1. Clone this repo
2. Install dependencies and build:
   ```sh
   npm install
   npm run build
   ```
3. Open `chrome://extensions/`, enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `qassist/` directory
5. (Optional) Pin the extension icon to the toolbar for quick access

## Setup

1. Right-click the qassist icon → **Options** (or open the popup and click ⚙)
2. Enter your Jira domain (e.g. `mycompany.atlassian.net`) — without `https://`
3. Click **Save & Test**
4. Make sure you're logged in to Jira in this browser. If you're not, the options page will show a login link.

That's it — no API tokens, no OAuth setup. The extension uses the session cookies from your logged-in Jira tab.

## Usage

1. Browse to the page where you encountered the bug
2. Click the qassist icon
3. Review the auto-filled form:
   - **Screenshot** — captured from the visible tab; uncheck to skip attaching
   - **Title** — pre-filled with the page title
   - **Steps to Reproduce / Expected / Actual** — fill in as needed
   - **Environment** — collapsed; auto-filled
   - **Console Errors / Failed Requests** — collapsed badges if any were captured
4. Either:
   - **Copy** — markdown report to clipboard
   - **Create Jira Issue** — picks project/type/priority, submits, returns a link

## Architecture

Chrome Manifest V3 with four runtime components:

| Component | File | Purpose |
|---|---|---|
| Service worker | [src/background/service-worker.ts](src/background/service-worker.ts) | Listens for failed requests via `webRequest`; stores console errors + failed requests per tab in memory; clears on navigation / tab close |
| Main-world script | [src/content/error-capture.ts](src/content/error-capture.ts) | Injected into every page; intercepts `console.error`, `window.onerror`, `unhandledrejection` |
| Content script | [src/content/content-script.ts](src/content/content-script.ts) | Isolated world bridge — injects the main-world script at `document_start` and relays captured errors to the service worker |
| Popup | [src/popup/popup.ts](src/popup/popup.ts) | Bug report form — assembles captured data, takes screenshot, drives Jira submission |
| Options page | [src/options/options.ts](src/options/options.ts) | Jira domain configuration + session validation |

Shared code:
- [src/lib/jira-client.ts](src/lib/jira-client.ts) — Jira Cloud REST API v3 wrapper (session-auth, ADF-formatted descriptions, multipart attachments)
- [src/lib/formatter.ts](src/lib/formatter.ts) — Markdown bug report generator
- [src/lib/storage.ts](src/lib/storage.ts) — `chrome.storage.local` wrappers for config + last-used selections
- [src/lib/types.ts](src/lib/types.ts) — Shared TypeScript interfaces

### Data flow

```
Page errors ─► error-capture.ts (main world)
                    │ window.postMessage
                    ▼
            content-script.ts (isolated world)
                    │ chrome.runtime.sendMessage
                    ▼
            service-worker.ts ◄── webRequest.onCompleted / onErrorOccurred
                    │
                    │ stored per-tab in Map<tabId, TabData>
                    │
Popup opens ────────┤
     │              │ chrome.runtime.sendMessage({type: 'get-tab-data'})
     │◄─────────────┘
     │
     ├─► chrome.tabs.captureVisibleTab()   → screenshot
     ├─► chrome.scripting.executeScript()  → viewport
     ├─► navigator.userAgent                → browser/OS
     │
     └─► [user fills form]
         │
         ├─► "Copy" → formatter.ts → navigator.clipboard
         │
         └─► "Create Jira Issue" → jira-client.ts
                                    ├─► POST /rest/api/3/issue
                                    └─► POST /rest/api/3/issue/{key}/attachments
```

### Jira auth

The extension uses your existing browser session — all Jira API requests are made with `credentials: 'include'`, so the browser sends the Atlassian session cookies automatically. The `X-Atlassian-Token: no-check` header bypasses Jira's XSRF protection for mutating requests. When the session expires, the extension detects a 401 or an HTML login-page response and shows a "Log in" link.

Host permissions are `<all_urls>` because the extension must observe network failures on any site and call the Jira domain you configure. No credentials are transmitted anywhere except to your Jira instance.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | `chrome.tabs.captureVisibleTab` for screenshots |
| `scripting` | `chrome.scripting.executeScript` to read viewport size from the page |
| `storage` | `chrome.storage.local` for Jira domain and last-used selections |
| `webRequest` | Observe failed network requests (`onCompleted` + `onErrorOccurred`) and detect main-frame navigations |
| `cookies` | Required for cookie-based Jira session auth |
| `host_permissions: <all_urls>` | Observe requests on any page + reach your Jira instance |

## Development

```sh
npm run build       # one-shot build via esbuild
npm run watch       # incremental rebuilds
npm run typecheck   # tsc --noEmit
```

After a build, reload the extension at `chrome://extensions/` (click the refresh icon on the qassist card).

### Debugging

- **Popup** — right-click inside the popup → Inspect. Look for `[qassist]` console logs.
- **Service worker** — `chrome://extensions/` → qassist → "service worker" link.
- **Content script / page** — normal page DevTools console shows `[qassist]` logs from the error capture script.
- **Jira API issues** — popup DevTools → Network tab, filter to your Atlassian domain.

## Project structure

```
qassist/
├── src/
│   ├── background/service-worker.ts     # Network monitor + message hub
│   ├── content/
│   │   ├── error-capture.ts             # Main-world error interception
│   │   └── content-script.ts            # Isolated world bridge
│   ├── popup/
│   │   ├── popup.html / .css / .ts      # Bug report form
│   ├── options/
│   │   ├── options.html / .css / .ts    # Jira configuration
│   ├── lib/
│   │   ├── jira-client.ts               # Jira Cloud REST API wrapper
│   │   ├── formatter.ts                 # Markdown report generator
│   │   ├── storage.ts                   # chrome.storage.local wrappers
│   │   └── types.ts                     # Shared interfaces
│   └── icons/                           # 16/48/128 PNG icons
├── manifest.json                         # MV3 manifest
├── build.mjs                             # esbuild script
├── tsconfig.json
└── package.json
```

## Known limitations

- **Errors before injection** — the error-capture script runs at `document_start`, but a handful of very early inline `<head>` scripts can still execute before it. Errors thrown during that tiny window won't be captured.
- **In-memory error storage** — console errors and failed requests live in the service worker's memory. MV3 service workers are terminated after ~30 seconds of idle. If a bug occurs and you wait a long time before opening the popup, the captured data may be gone.
- **Cross-tab scope** — error capture is per-tab; opening the popup in one tab won't show data captured in another.
- **SPA route changes** — "page load" cleanup is triggered on main-frame navigations. Client-side route changes in SPAs don't clear the store, so errors accumulate until a real page load or tab close.
