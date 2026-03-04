import type { AccessibilityNode } from '../types/index';
import type { RefRegistry } from './ref-registry';

interface RawAXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  parentId?: string;
  childIds?: string[];
  backendDOMNodeId?: number;
}

/**
 * Extracts the full accessibility tree via CDP and converts it
 * to the AccessibilityNode tree structure with ref assignments.
 */
export async function extractAccessibilityTree(
  sendCommand: (method: string, params?: any) => Promise<any>,
  registry: RefRegistry,
): Promise<{ tree: AccessibilityNode; text: string }> {
  const { nodes } = await sendCommand('Accessibility.getFullAXTree', {}) as { nodes: RawAXNode[] };

  // Build a map of nodeId -> AccessibilityNode
  const nodeMap = new Map<string, AccessibilityNode>();
  const rawMap = new Map<string, RawAXNode>();
  const childOrder = new Map<string, string[]>();

  for (const raw of nodes) {
    rawMap.set(raw.nodeId, raw);
    if (raw.childIds) {
      childOrder.set(raw.nodeId, raw.childIds);
    }
  }

  // First pass: create AccessibilityNode for non-ignored nodes
  for (const raw of nodes) {
    if (raw.ignored) continue;

    const role = raw.role?.value ?? 'none';
    const name = raw.name?.value ?? '';
    const description = raw.description?.value;

    const axNode: AccessibilityNode = {
      nodeId: raw.nodeId,
      role,
      name,
      description,
      children: [],
    };

    // Extract properties
    if (raw.properties) {
      for (const prop of raw.properties) {
        const val = prop.value.value;
        switch (prop.name) {
          case 'level':
            axNode.level = val as number;
            break;
          case 'checked':
            axNode.checked = val as 'true' | 'false' | 'mixed';
            break;
          case 'selected':
            axNode.selected = val as boolean;
            break;
          case 'expanded':
            axNode.expanded = val as boolean;
            break;
          case 'disabled':
            axNode.disabled = val as boolean;
            break;
          case 'required':
            axNode.required = val as boolean;
            break;
          case 'invalid':
            axNode.invalid = val as boolean;
            break;
          case 'focused':
            axNode.focused = val as boolean;
            break;
        }
      }
    }

    // Extract value from properties if present
    const valueProp = raw.properties?.find(p => p.name === 'value');
    if (valueProp) {
      axNode.value = String(valueProp.value.value);
    }

    // Store backendDOMNodeId
    if (raw.backendDOMNodeId !== undefined) {
      axNode.backendNodeId = raw.backendDOMNodeId;
    }

    nodeMap.set(raw.nodeId, axNode);
  }

  // Second pass: build tree with parent-child relationships
  // Collapse generic/none containers without names
  let rootNode: AccessibilityNode | undefined;

  for (const raw of nodes) {
    if (raw.ignored) continue;
    const node = nodeMap.get(raw.nodeId);
    if (!node) continue;

    const childIds = childOrder.get(raw.nodeId) ?? [];
    for (const childId of childIds) {
      const childRaw = rawMap.get(childId);
      if (!childRaw || childRaw.ignored) {
        // If child is ignored, gather its descendants
        collectDescendants(childId, rawMap, nodeMap, childOrder, node);
        continue;
      }

      const childNode = nodeMap.get(childId);
      if (!childNode) continue;

      // Collapse unnamed generic/none containers
      if (shouldCollapse(childNode)) {
        // Attach grandchildren directly to current node
        const grandchildIds = childOrder.get(childId) ?? [];
        for (const gcId of grandchildIds) {
          const gcRaw = rawMap.get(gcId);
          if (!gcRaw || gcRaw.ignored) {
            collectDescendants(gcId, rawMap, nodeMap, childOrder, node);
            continue;
          }
          const gcNode = nodeMap.get(gcId);
          if (gcNode) {
            if (shouldCollapse(gcNode)) {
              // Recursively collapse
              flattenInto(gcNode, gcId, rawMap, nodeMap, childOrder, node);
            } else {
              node.children.push(gcNode);
            }
          }
        }
      } else {
        node.children.push(childNode);
      }
    }

    // Track root (first non-ignored node with no parent or ignored parent)
    if (!rootNode && (!raw.parentId || !nodeMap.has(raw.parentId))) {
      rootNode = node;
    }
  }

  if (!rootNode) {
    rootNode = {
      nodeId: 'root',
      role: 'WebArea',
      name: '',
      children: [],
    };
  }

  // Third pass: assign refs to interactive nodes
  assignRefsRecursive(rootNode, registry);

  // Generate text representation
  const text = formatTreeAsText(rootNode, 0);

  return { tree: rootNode, text };
}

function shouldCollapse(node: AccessibilityNode): boolean {
  return !node.name && (node.role === 'generic' || node.role === 'none');
}

function collectDescendants(
  nodeId: string,
  rawMap: Map<string, RawAXNode>,
  nodeMap: Map<string, AccessibilityNode>,
  childOrder: Map<string, string[]>,
  parent: AccessibilityNode,
): void {
  const childIds = childOrder.get(nodeId) ?? [];
  for (const cid of childIds) {
    const cRaw = rawMap.get(cid);
    if (!cRaw || cRaw.ignored) {
      collectDescendants(cid, rawMap, nodeMap, childOrder, parent);
      continue;
    }
    const cNode = nodeMap.get(cid);
    if (cNode) {
      if (shouldCollapse(cNode)) {
        flattenInto(cNode, cid, rawMap, nodeMap, childOrder, parent);
      } else {
        parent.children.push(cNode);
      }
    }
  }
}

function flattenInto(
  node: AccessibilityNode,
  nodeId: string,
  rawMap: Map<string, RawAXNode>,
  nodeMap: Map<string, AccessibilityNode>,
  childOrder: Map<string, string[]>,
  parent: AccessibilityNode,
): void {
  const childIds = childOrder.get(nodeId) ?? [];
  for (const cid of childIds) {
    const cRaw = rawMap.get(cid);
    if (!cRaw || cRaw.ignored) {
      collectDescendants(cid, rawMap, nodeMap, childOrder, parent);
      continue;
    }
    const cNode = nodeMap.get(cid);
    if (cNode) {
      if (shouldCollapse(cNode)) {
        flattenInto(cNode, cid, rawMap, nodeMap, childOrder, parent);
      } else {
        parent.children.push(cNode);
      }
    }
  }
}

function assignRefsRecursive(node: AccessibilityNode, registry: RefRegistry): void {
  const ref = registry.assignRef(
    node.role,
    node.name,
    node.backendNodeId ?? 0,
    node.value,
    node.description,
  );
  if (ref) {
    node.ref = ref;
  }

  for (const child of node.children) {
    assignRefsRecursive(child, registry);
  }
}

function formatTreeAsText(node: AccessibilityNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const refPrefix = node.ref ? `${node.ref} ` : '';
  const namePart = node.name ? ` "${node.name}"` : '';
  const valuePart = node.value ? ` value="${node.value}"` : '';

  let line = `${indent}[${refPrefix}${node.role}]${namePart}${valuePart}`;

  const childLines = node.children
    .map(child => formatTreeAsText(child, depth + 1))
    .filter(l => l.length > 0);

  if (childLines.length > 0) {
    return line + '\n' + childLines.join('\n');
  }
  return line;
}
