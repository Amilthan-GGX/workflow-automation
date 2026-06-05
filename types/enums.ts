export enum BrowserStageId {
  Session = 'session',
  Navigate = 'navigate',
  Download = 'download',
}

export enum AutomationErrorType {
  AuthExpired = 'AUTH_EXPIRED',
  AuthFailed = 'AUTH_FAILED',
  SelectorNotFound = 'SELECTOR_NOT_FOUND',
  NavigationTimeout = 'NAVIGATION_TIMEOUT',
  DownloadTimeout = 'DOWNLOAD_TIMEOUT',
  DownloadCorrupt = 'DOWNLOAD_CORRUPT',
  NetworkError = 'NETWORK_ERROR',
  Unknown = 'UNKNOWN',
}

export enum RetryStrategy {
  None = 'NONE',
  Fixed = 'FIXED',
  Exponential = 'EXPONENTIAL',
}
