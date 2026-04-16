// Content script: runs in isolated world at document_start.
// 1. Injects error-capture.ts into the main world
// 2. Relays captured errors to the service worker

// Inject the main-world error capture script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('dist/content/error-capture.js');
script.type = 'module';
(document.documentElement || document.head || document.body).appendChild(script);
script.onload = () => script.remove();

// Relay errors from the main world to the service worker
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'qassist-error-capture') return;

  chrome.runtime.sendMessage({
    type: 'console-error',
    error: event.data.error,
  });
});
