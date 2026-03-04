import type { DomNode } from '../types/index';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Serializes a DomNode IR back into an HTML string.
 */
export function serializeToHtml(node: DomNode): string {
  const attrs = serializeAttrs(node.attrs);
  const open = `<${node.tag}${attrs}>`;

  if (VOID_ELEMENTS.has(node.tag)) {
    return open;
  }

  const childrenHtml = node.children
    .map(child => (typeof child === 'string' ? child : serializeToHtml(child)))
    .join('');

  return `${open}${childrenHtml}</${node.tag}>`;
}

function serializeAttrs(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === '') {
      parts.push(key);
    } else {
      parts.push(`${key}="${escapeAttr(value)}"`);
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
