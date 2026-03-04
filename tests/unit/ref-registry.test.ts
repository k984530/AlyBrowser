import { describe, it, expect, beforeEach } from 'vitest';
import { RefRegistry } from '../../src/extractors/ref-registry';

describe('RefRegistry', () => {
  let registry: RefRegistry;

  beforeEach(() => {
    registry = new RefRegistry();
  });

  it('assigns sequential ref IDs to interactive roles', () => {
    const ref1 = registry.assignRef('button', 'Submit', 101);
    const ref2 = registry.assignRef('link', 'Home', 102);
    const ref3 = registry.assignRef('textbox', 'Search', 103);

    expect(ref1).toBe('@e1');
    expect(ref2).toBe('@e2');
    expect(ref3).toBe('@e3');
  });

  it('returns empty string for non-interactive roles', () => {
    const ref = registry.assignRef('heading', 'Title', 200);
    expect(ref).toBe('');
  });

  it('stores and retrieves elements by ref', () => {
    registry.assignRef('button', 'OK', 101);
    const element = registry.getElement('@e1');

    expect(element).toBeDefined();
    expect(element!.role).toBe('button');
    expect(element!.name).toBe('OK');
    expect(element!.backendNodeId).toBe(101);
  });

  it('resolves ref to backendNodeId', () => {
    registry.assignRef('link', 'About', 55);
    expect(registry.resolveRef('@e1')).toBe(55);
  });

  it('throws ElementNotFoundError for unknown ref', () => {
    expect(() => registry.resolveRef('@e99')).toThrow('not found');
  });

  it('looks up ref by backendNodeId', () => {
    registry.assignRef('button', 'Click', 42);
    expect(registry.getRefByBackendNodeId(42)).toBe('@e1');
    expect(registry.getRefByBackendNodeId(999)).toBeUndefined();
  });

  it('returns all elements', () => {
    registry.assignRef('button', 'A', 1);
    registry.assignRef('link', 'B', 2);
    registry.assignRef('heading', 'C', 3); // non-interactive

    const elements = registry.getAllElements();
    expect(elements).toHaveLength(2);
    expect(elements[0].ref).toBe('@e1');
    expect(elements[1].ref).toBe('@e2');
  });

  it('resets state correctly', () => {
    registry.assignRef('button', 'X', 10);
    expect(registry.getAllElements()).toHaveLength(1);

    registry.reset();
    expect(registry.getAllElements()).toHaveLength(0);

    const ref = registry.assignRef('button', 'Y', 20);
    expect(ref).toBe('@e1'); // counter resets
  });

  it('handles all interactive roles', () => {
    const roles = [
      'button', 'link', 'textbox', 'searchbox', 'checkbox',
      'radio', 'combobox', 'listbox', 'menuitem', 'switch', 'tab',
    ];

    for (const role of roles) {
      const ref = registry.assignRef(role, role, 100);
      expect(ref).toMatch(/^@e\d+$/);
    }
  });
});
