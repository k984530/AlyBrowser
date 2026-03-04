// ── Core Classes ─────────────────────────────────────────────────────
export { AlyBrowser } from './browser';
export { AlyPage } from './page';

// ── Errors ───────────────────────────────────────────────────────────
export {
  AlyBrowserError,
  ChromeNotFoundError,
  ChromeLaunchError,
  ChromeCrashedError,
  CDPConnectionError,
  CDPTimeoutError,
  CDPProtocolError,
  NavigationTimeoutError,
  NavigationFailedError,
  ElementNotFoundError,
  ElementStaleError,
  ElementNotInteractableError,
} from './cdp/errors';

// ── Types ────────────────────────────────────────────────────────────
export type {
  LaunchOptions,
  ConnectOptions,
  Viewport,
  GotoOptions,
  WaitOptions,
  ClickOptions,
  TypeOptions,
  ScrollOptions,
  AccessibilityNode,
  RefElement,
  Snapshot,
  PageMeta,
} from './types';
