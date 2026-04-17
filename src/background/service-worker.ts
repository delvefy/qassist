import type { TabData, ConsoleError, FailedRequest, Message } from '../lib/types.js';

const tabStore = new Map<number, TabData>();

function getTabData(tabId: number): TabData {
  let data = tabStore.get(tabId);
  if (!data) {
    data = { consoleErrors: [], failedRequests: [] };
    tabStore.set(tabId, data);
  }
  return data;
}

function pushConsoleError(tabId: number, error: ConsoleError) {
  const data = getTabData(tabId);
  data.consoleErrors.push(error);
  // Keep last 100 errors per tab
  if (data.consoleErrors.length > 100) {
    data.consoleErrors.shift();
  }
}

function pushFailedRequest(tabId: number, request: FailedRequest) {
  const data = getTabData(tabId);
  data.failedRequests.push(request);
  // Keep last 50 failed requests per tab
  if (data.failedRequests.length > 50) {
    data.failedRequests.shift();
  }
}

// Listen for console errors forwarded from content scripts
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (message.type === 'console-error' && sender.tab?.id != null) {
    pushConsoleError(sender.tab.id, message.error);
    return;
  }

  if (message.type === 'get-tab-data') {
    const data = tabStore.get(message.tabId) ?? { consoleErrors: [], failedRequests: [] };
    sendResponse({ type: 'tab-data', data });
    return true; // keep channel open for async response
  }
});

// Monitor failed network requests
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId >= 0 && details.statusCode >= 400) {
      pushFailedRequest(details.tabId, {
        url: details.url,
        method: details.method,
        statusCode: details.statusCode,
        resourceType: details.type,
        timestamp: details.timeStamp,
      });
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId >= 0) {
      pushFailedRequest(details.tabId, {
        url: details.url,
        method: details.method,
        statusCode: null,
        error: details.error,
        resourceType: details.type,
        timestamp: details.timeStamp,
      });
    }
  },
  { urls: ['<all_urls>'] }
);

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStore.delete(tabId);
});

// Clear tab data on main-frame navigations using webRequest (we already have this permission).
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.type === 'main_frame' && details.tabId >= 0) {
      tabStore.delete(details.tabId);
    }
  },
  { urls: ['<all_urls>'] }
);

// Make clicking the toolbar icon open the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[qassist] setPanelBehavior failed:', err));
});

console.log('qassist service worker initialized');
