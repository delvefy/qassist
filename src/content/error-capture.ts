// This script runs in the MAIN world (page context) to intercept JS errors.
// It communicates with the content script via window.postMessage.

const SOURCE = 'qassist-error-capture';

// Override console.error
const originalConsoleError = console.error;
console.error = function (...args: unknown[]) {
  try {
    const message = args.map(a => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');

    window.postMessage({
      source: SOURCE,
      error: {
        message,
        stack: new Error().stack ?? undefined,
        timestamp: Date.now(),
        type: 'error',
      },
    }, '*');
  } catch {
    // Never break the page
  }
  originalConsoleError.apply(console, args);
};

// Catch uncaught exceptions
window.addEventListener('error', (event) => {
  try {
    window.postMessage({
      source: SOURCE,
      error: {
        message: event.message || String(event.error),
        stack: event.error?.stack ?? undefined,
        timestamp: Date.now(),
        type: 'uncaught' as const,
      },
    }, '*');
  } catch {
    // Never break the page
  }
});

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string' ? reason : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;

    window.postMessage({
      source: SOURCE,
      error: {
        message,
        stack,
        timestamp: Date.now(),
        type: 'unhandledrejection' as const,
      },
    }, '*');
  } catch {
    // Never break the page
  }
});
