export interface ConsoleError {
  message: string;
  stack?: string;
  timestamp: number;
  type: 'error' | 'unhandledrejection' | 'uncaught';
}

export interface FailedRequest {
  url: string;
  method: string;
  statusCode: number | null;
  error?: string;
  resourceType: string;
  timestamp: number;
}

export interface TabData {
  consoleErrors: ConsoleError[];
  failedRequests: FailedRequest[];
}

export interface EnvironmentInfo {
  url: string;
  title: string;
  userAgent: string;
  browser: string;
  os: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface BugReport {
  title: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  environment: EnvironmentInfo;
  consoleErrors: ConsoleError[];
  failedRequests: FailedRequest[];
  screenshotDataUrl?: string;
}

export interface JiraConfig {
  domain: string;
  defaultProject?: string;
  defaultIssueType?: string;
  defaultPriority?: string;
}

// Message types between components
export type Message =
  | { type: 'console-error'; error: ConsoleError }
  | { type: 'get-tab-data'; tabId: number }
  | { type: 'tab-data'; data: TabData };
