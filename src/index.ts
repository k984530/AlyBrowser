// ── Errors ───────────────────────────────────────────────────────────
export { AlyBrowserError, ChromeNotFoundError } from './errors';

// ── Extension Bridge ─────────────────────────────────────────────────
export { ExtensionBridge } from './extension/bridge';

// ── Auth ─────────────────────────────────────────────────────────────
export { generateSecret, signJwt, verifyJwt } from './auth/token';
export type { TokenPayload } from './auth/token';
