import type { Snapshot } from '../types/index';
import { getDomFilterScript } from '../dom/filter';
import { extractAccessibilityTree } from './accessibility';
import { convertHtmlToMarkdown } from './markdown';
import { RefRegistry } from './ref-registry';

/**
 * Builds a full page snapshot including accessibility tree,
 * markdown content, and page metadata.
 */
export async function buildSnapshot(
  sendCommand: (method: string, params?: any) => Promise<any>,
  registry: RefRegistry,
): Promise<Snapshot> {
  // 1. Reset registry for fresh snapshot
  registry.reset();

  // 2. Extract page metadata BEFORE DOM filtering (filter removes <meta> tags)
  const { result: metaResult } = await sendCommand('Runtime.evaluate', {
    expression: `(() => {
      const getMeta = (name) => {
        const el = document.querySelector('meta[name="' + name + '"]') ||
                   document.querySelector('meta[property="' + name + '"]');
        return el ? el.getAttribute('content') : undefined;
      };
      return JSON.stringify({
        title: document.title,
        url: location.href,
        language: document.documentElement.lang || undefined,
        description: getMeta('description'),
        viewport: getMeta('viewport'),
      });
    })()`,
    returnByValue: true,
  });
  const pageMeta = JSON.parse(metaResult?.value ?? '{}');

  // 3. Extract accessibility tree (assigns refs to interactive elements)
  const { tree, text: accessibilityText } = await extractAccessibilityTree(
    sendCommand,
    registry,
  );

  // 4. Run DOM filter script to get cleaned HTML
  const { result } = await sendCommand('Runtime.evaluate', {
    expression: getDomFilterScript(),
    returnByValue: true,
  });
  const cleanedHtml: string = result?.value ?? '';

  // 5. Convert HTML to Markdown with ref annotations
  const elements = registry.getAllElements();
  const markdown = convertHtmlToMarkdown(cleanedHtml, elements);

  return {
    url: pageMeta.url ?? '',
    title: pageMeta.title ?? '',
    accessibilityTree: tree,
    accessibilityText,
    markdown,
    elements,
    meta: {
      language: pageMeta.language,
      description: pageMeta.description,
      viewport: pageMeta.viewport,
    },
  };
}
