import type { RefElement } from '../types/index';
import { INTERACTIVE_ROLES } from '../types/index';
import { ElementNotFoundError } from '../cdp/errors';

/**
 * Registry for interactive element references (@eN).
 * Assigns sequential ref IDs to interactive accessibility nodes
 * and provides lookup by ref string or backendNodeId.
 */
export class RefRegistry {
  private counter = 0;
  private refs = new Map<string, RefElement>();
  private backendNodeIdToRef = new Map<number, string>();

  /** Reset all state. Called at the start of each snapshot. */
  reset(): void {
    this.counter = 0;
    this.refs.clear();
    this.backendNodeIdToRef.clear();
  }

  /**
   * Assigns a ref ID if the role is interactive.
   * Returns the ref string (e.g. "@e1") or empty string if not interactive.
   */
  assignRef(
    role: string,
    name: string,
    backendNodeId: number,
    value?: string,
    description?: string,
  ): string {
    if (!INTERACTIVE_ROLES.has(role)) {
      return '';
    }

    this.counter += 1;
    const ref = `@e${this.counter}`;

    const element: RefElement = {
      ref,
      role,
      name,
      backendNodeId,
      value,
      description,
    };

    this.refs.set(ref, element);
    if (backendNodeId !== 0) {
      this.backendNodeIdToRef.set(backendNodeId, ref);
    }

    return ref;
  }

  /** Look up a RefElement by its ref string. */
  getElement(ref: string): RefElement | undefined {
    return this.refs.get(ref);
  }

  /** Look up a ref string by backendNodeId. */
  getRefByBackendNodeId(backendNodeId: number): string | undefined {
    return this.backendNodeIdToRef.get(backendNodeId);
  }

  /** Returns all registered RefElements. */
  getAllElements(): RefElement[] {
    return Array.from(this.refs.values());
  }

  /**
   * Resolves a ref string to its backendNodeId.
   * Throws ElementNotFoundError if the ref is not registered.
   */
  resolveRef(ref: string): number {
    const element = this.refs.get(ref);
    if (!element) {
      throw new ElementNotFoundError(ref);
    }
    return element.backendNodeId;
  }
}
