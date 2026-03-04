// ── Launch & Connection Options ──────────────────────────────────────

export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
  userDataDir?: string;
  args?: string[];
  timeout?: number;
  defaultViewport?: Viewport | null;
}

export interface ConnectOptions {
  browserWSEndpoint?: string;
  browserURL?: string;
  timeout?: number;
  defaultViewport?: Viewport | null;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

// ── CDP Types ────────────────────────────────────────────────────────

export interface CDPSendOptions {
  sessionId?: string;
  timeout?: number;
}

export interface CDPResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: string };
}

export interface CDPEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

// ── Accessibility ────────────────────────────────────────────────────

export interface AccessibilityNode {
  nodeId: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  level?: number;
  checked?: 'true' | 'false' | 'mixed';
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  focused?: boolean;
  ref?: string;            // @eN ref ID
  backendNodeId?: number;
  children: AccessibilityNode[];
}

// ── Ref System ───────────────────────────────────────────────────────

export interface RefElement {
  ref: string;              // e.g., "@e1"
  role: string;
  name: string;
  value?: string;
  backendNodeId: number;
  description?: string;
}

// ── Snapshot ─────────────────────────────────────────────────────────

export interface Snapshot {
  url: string;
  title: string;
  accessibilityTree: AccessibilityNode;
  accessibilityText: string;
  markdown: string;
  elements: RefElement[];
  meta: PageMeta;
}

export interface PageMeta {
  language?: string;
  description?: string;
  viewport?: string;
}

// ── Navigation ───────────────────────────────────────────────────────

export interface GotoOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface WaitOptions {
  timeout?: number;
  polling?: number;
}

// ── Actions ──────────────────────────────────────────────────────────

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export interface TypeOptions {
  delay?: number;
  clear?: boolean;
}

export interface ScrollOptions {
  x?: number;
  y?: number;
  behavior?: 'smooth' | 'instant';
}

// ── DOM IR (Intermediate Representation) ─────────────────────────────

export interface DomNode {
  tag: string;
  attrs: Record<string, string>;
  children: (DomNode | string)[];
  ref?: string;
}

// ── Interactivity Roles ──────────────────────────────────────────────

export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'treeitem',
]);
