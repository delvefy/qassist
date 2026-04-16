import type { JiraConfig, BugReport } from './types.js';

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  iconUrl?: string;
}

export interface JiraPriority {
  id: string;
  name: string;
}

export interface CreatedIssue {
  id: string;
  key: string;
  self: string;
}

export class JiraError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class JiraNotLoggedInError extends JiraError {
  constructor(message = 'Not logged in to Jira in this browser') {
    super(message, 401, null);
    this.name = 'JiraNotLoggedInError';
  }
}

// Build ADF (Atlassian Document Format) description from a bug report
function buildAdfDescription(report: BugReport): unknown {
  const content: unknown[] = [];

  const addHeading = (text: string) => {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text }],
    });
  };

  const addParagraph = (text: string) => {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    });
  };

  const addCodeBlock = (text: string) => {
    content.push({
      type: 'codeBlock',
      content: [{ type: 'text', text }],
    });
  };

  if (report.stepsToReproduce.trim()) {
    addHeading('Steps to Reproduce');
    addParagraph(report.stepsToReproduce.trim());
  }

  if (report.expectedBehavior.trim()) {
    addHeading('Expected Behavior');
    addParagraph(report.expectedBehavior.trim());
  }

  if (report.actualBehavior.trim()) {
    addHeading('Actual Behavior');
    addParagraph(report.actualBehavior.trim());
  }

  addHeading('Environment');
  const env = report.environment;
  addCodeBlock(
    `URL: ${env.url}\n` +
    `Browser: ${env.browser}\n` +
    `OS: ${env.os}\n` +
    `Viewport: ${env.viewportWidth}x${env.viewportHeight} (${env.devicePixelRatio}x)\n` +
    `User-Agent: ${env.userAgent}`
  );

  if (report.consoleErrors.length > 0) {
    addHeading(`Console Errors (${report.consoleErrors.length})`);
    const text = report.consoleErrors
      .map((e) => `[${e.type}] ${e.message}${e.stack ? '\n' + e.stack : ''}`)
      .join('\n\n');
    addCodeBlock(text);
  }

  if (report.failedRequests.length > 0) {
    addHeading(`Failed Network Requests (${report.failedRequests.length})`);
    const text = report.failedRequests
      .map((r) => {
        const status = r.statusCode ? String(r.statusCode) : r.error ?? 'failed';
        return `${r.method} ${r.url} → ${status} (${r.resourceType})`;
      })
      .join('\n');
    addCodeBlock(text);
  }

  return {
    type: 'doc',
    version: 1,
    content,
  };
}

/**
 * JiraClient that uses the browser's existing Jira session cookies.
 *
 * Requires:
 * - Extension `cookies` permission and host_permissions for the Jira domain
 * - User logged in to Jira Cloud in this browser
 *
 * All requests use credentials: 'include' so the browser sends the
 * atlassian session cookies automatically. The X-Atlassian-Token: no-check
 * header bypasses Jira's XSRF protection for mutating requests.
 */
export class JiraClient {
  private baseUrl: string;

  constructor(private config: JiraConfig) {
    const domain = config.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.baseUrl = `https://${domain}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // no-check bypasses Jira's XSRF protection when using session cookies
      'X-Atlassian-Token': 'no-check',
      ...(init.headers as Record<string, string> | undefined),
    };
    if (typeof init.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // 15 second timeout so we never hang
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new JiraError('Request timed out', 0, null);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 401) {
      throw new JiraNotLoggedInError();
    }

    // If the response is HTML, the request was redirected to a login page
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new JiraNotLoggedInError('Jira returned HTML (likely login page)');
    }

    if (!response.ok) {
      let body: unknown;
      try { body = await response.json(); } catch { body = await response.text().catch(() => ''); }
      throw new JiraError(
        `Jira API ${response.status}: ${response.statusText}`,
        response.status,
        body
      );
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * Validates that the user is logged in to Jira in this browser.
   * Returns current user info on success, throws JiraNotLoggedInError otherwise.
   */
  async validateCredentials(): Promise<{ accountId: string; displayName: string; emailAddress?: string }> {
    return this.request('/rest/api/3/myself');
  }

  async getProjects(): Promise<JiraProject[]> {
    const data = await this.request<{ values: JiraProject[] }>(
      '/rest/api/3/project/search?maxResults=100&orderBy=name'
    );
    return data.values.map((p) => ({ id: p.id, key: p.key, name: p.name }));
  }

  async getIssueTypes(projectKey: string): Promise<JiraIssueType[]> {
    const data = await this.request<{ issueTypes: JiraIssueType[] }>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`
    );
    return (data.issueTypes ?? []).map((t) => ({ id: t.id, name: t.name, iconUrl: t.iconUrl }));
  }

  async getPriorities(): Promise<JiraPriority[]> {
    return this.request<JiraPriority[]>('/rest/api/3/priority');
  }

  async createIssue(params: {
    projectKey: string;
    issueTypeId: string;
    priorityId?: string;
    summary: string;
    report: BugReport;
  }): Promise<CreatedIssue> {
    const fields: Record<string, unknown> = {
      project: { key: params.projectKey },
      issuetype: { id: params.issueTypeId },
      summary: params.summary,
      description: buildAdfDescription(params.report),
    };
    if (params.priorityId) {
      fields.priority = { id: params.priorityId };
    }

    return this.request<CreatedIssue>('/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }

  async attachScreenshot(issueKey: string, dataUrl: string): Promise<void> {
    const blob = await (await fetch(dataUrl)).blob();
    const formData = new FormData();
    formData.append('file', blob, `screenshot-${Date.now()}.png`);

    await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
      method: 'POST',
      body: formData,
    });
  }

  issueUrl(issueKey: string): string {
    return `${this.baseUrl}/browse/${issueKey}`;
  }

  loginUrl(): string {
    return `${this.baseUrl}/login`;
  }
}
