import type { DomNode } from '../types/index';

/**
 * Depth-first traversal of a DomNode tree.
 */
export function walkDom(
  node: DomNode,
  callback: (node: DomNode, depth: number) => void,
): void {
  walk(node, callback, 0);
}

function walk(
  node: DomNode,
  callback: (node: DomNode, depth: number) => void,
  depth: number,
): void {
  callback(node, depth);
  for (const child of node.children) {
    if (typeof child !== 'string') {
      walk(child, callback, depth + 1);
    }
  }
}

/**
 * Finds all DomNodes matching a predicate via DFS.
 */
export function findDomNodes(
  node: DomNode,
  predicate: (n: DomNode) => boolean,
): DomNode[] {
  const results: DomNode[] = [];
  walkDom(node, (n) => {
    if (predicate(n)) {
      results.push(n);
    }
  });
  return results;
}
