import type { BugReport } from './types.js';

export function formatAsMarkdown(report: BugReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push('');

  if (report.stepsToReproduce.trim()) {
    lines.push('## Steps to Reproduce');
    lines.push(report.stepsToReproduce.trim());
    lines.push('');
  }

  if (report.expectedBehavior.trim()) {
    lines.push('## Expected Behavior');
    lines.push(report.expectedBehavior.trim());
    lines.push('');
  }

  if (report.actualBehavior.trim()) {
    lines.push('## Actual Behavior');
    lines.push(report.actualBehavior.trim());
    lines.push('');
  }

  lines.push('## Environment');
  lines.push('```');
  lines.push(`URL: ${report.environment.url}`);
  lines.push(`Browser: ${report.environment.browser}`);
  lines.push(`OS: ${report.environment.os}`);
  lines.push(`Viewport: ${report.environment.viewportWidth}x${report.environment.viewportHeight} (${report.environment.devicePixelRatio}x)`);
  lines.push('```');
  lines.push('');

  if (report.consoleErrors.length > 0) {
    lines.push('## Console Errors');
    lines.push('```');
    for (const err of report.consoleErrors) {
      lines.push(`[${err.type}] ${err.message}`);
      if (err.stack) {
        lines.push(err.stack);
      }
      lines.push('');
    }
    lines.push('```');
    lines.push('');
  }

  if (report.failedRequests.length > 0) {
    lines.push('## Failed Network Requests');
    lines.push('```');
    for (const req of report.failedRequests) {
      const status = req.statusCode ? `${req.statusCode}` : req.error ?? 'failed';
      lines.push(`${req.method} ${req.url} → ${status} (${req.resourceType})`);
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}
