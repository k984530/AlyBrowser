import { Parser } from 'htmlparser2';
import type { RefElement } from '../types/index';

interface TagState {
  tag: string;
  attrs: Record<string, string>;
  content: string;
  listIndex?: number; // for ordered lists
}

/**
 * Converts filtered HTML to a Markdown string with optional @eN ref annotations.
 *
 * If refElements is provided, interactive elements are matched in order
 * and annotated with their ref IDs from the accessibility tree.
 */
export function convertHtmlToMarkdown(
  html: string,
  refElements?: RefElement[],
): string {
  const lines: string[] = [];
  const stack: TagState[] = [];
  let refIndex = 0;
  let inPre = false;
  let inCode = false;

  function currentState(): TagState | undefined {
    return stack[stack.length - 1];
  }

  function pushText(text: string): void {
    const state = currentState();
    if (state) {
      state.content += text;
    } else {
      lines.push(text);
    }
  }

  function nextRef(): RefElement | undefined {
    if (refElements && refIndex < refElements.length) {
      return refElements[refIndex++];
    }
    return undefined;
  }

  function flushLine(text: string): void {
    lines.push(text);
  }

  const parser = new Parser(
    {
      onopentag(tag: string, attrs: Record<string, string>) {
        const lowerTag = tag.toLowerCase();

        switch (lowerTag) {
          case 'pre':
            inPre = true;
            flushLine('```');
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'code':
            inCode = true;
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'a':
          case 'button':
          case 'select':
          case 'textarea':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'input':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'strong':
          case 'b':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'em':
          case 'i':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'img': {
            const alt = attrs.alt ?? '';
            const src = attrs.src ?? '';
            pushText(`![${alt}](${src})`);
            break;
          }

          case 'br':
            pushText('\n');
            break;

          case 'hr':
            flushLine('---');
            break;

          case 'ul':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'ol':
            stack.push({ tag: lowerTag, attrs, content: '', listIndex: 0 });
            break;

          case 'li':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'table':
          case 'thead':
          case 'tbody':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'tr':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'th':
          case 'td':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          case 'p':
          case 'div':
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;

          default:
            stack.push({ tag: lowerTag, attrs, content: '' });
            break;
        }
      },

      ontext(text: string) {
        if (inPre) {
          pushText(text);
          return;
        }
        // Collapse whitespace outside of pre blocks
        const collapsed = text.replace(/\s+/g, ' ');
        if (collapsed === ' ' && !currentState()) return;
        pushText(collapsed);
      },

      onclosetag(tag: string) {
        const lowerTag = tag.toLowerCase();
        const state = stack.pop();
        if (!state) return;

        const content = state.content.trim();

        switch (lowerTag) {
          case 'pre':
            inPre = false;
            flushLine(state.content); // preserve whitespace in pre
            flushLine('```');
            break;

          case 'code':
            inCode = false;
            if (inPre) {
              // Inside pre, just pass content up
              pushText(content);
            } else {
              pushText(`\`${content}\``);
            }
            break;

          case 'h1':
            flushLine(`# ${content}`);
            break;
          case 'h2':
            flushLine(`## ${content}`);
            break;
          case 'h3':
            flushLine(`### ${content}`);
            break;
          case 'h4':
            flushLine(`#### ${content}`);
            break;
          case 'h5':
            flushLine(`##### ${content}`);
            break;
          case 'h6':
            flushLine(`###### ${content}`);
            break;

          case 'a': {
            const href = state.attrs.href ?? '';
            const ref = nextRef();
            if (ref) {
              pushText(`[${ref.ref} link: "${content}"](${href})`);
            } else {
              pushText(`[${content}](${href})`);
            }
            break;
          }

          case 'button': {
            const ref = nextRef();
            if (ref) {
              pushText(`[${ref.ref} button: "${content}"]`);
            } else {
              pushText(`[button: "${content}"]`);
            }
            break;
          }

          case 'input': {
            const type = state.attrs.type ?? 'text';
            const value = state.attrs.value ?? '';
            const placeholder = state.attrs.placeholder ?? '';
            const ref = nextRef();
            let role = 'textbox';
            if (type === 'checkbox') role = 'checkbox';
            else if (type === 'radio') role = 'radio';
            else if (type === 'search') role = 'searchbox';

            const placeholderPart = placeholder ? ` placeholder="${placeholder}"` : '';
            if (ref) {
              pushText(`[${ref.ref} ${role}: "${value}"${placeholderPart}]`);
            } else {
              pushText(`[${role}: "${value}"${placeholderPart}]`);
            }
            break;
          }

          case 'select': {
            const ref = nextRef();
            if (ref) {
              pushText(`[${ref.ref} combobox: "${content}"]`);
            } else {
              pushText(`[combobox: "${content}"]`);
            }
            break;
          }

          case 'textarea': {
            const value = state.attrs.value ?? content;
            const ref = nextRef();
            if (ref) {
              pushText(`[${ref.ref} textbox: "${value}"]`);
            } else {
              pushText(`[textbox: "${value}"]`);
            }
            break;
          }

          case 'strong':
          case 'b':
            pushText(`**${content}**`);
            break;

          case 'em':
          case 'i':
            pushText(`*${content}*`);
            break;

          case 'li': {
            // Find parent list type
            const parentState = currentState();
            if (parentState?.tag === 'ol') {
              parentState.listIndex = (parentState.listIndex ?? 0) + 1;
              flushLine(`${parentState.listIndex}. ${content}`);
            } else {
              flushLine(`- ${content}`);
            }
            break;
          }

          case 'ul':
          case 'ol':
            // List wrapper, content is already flushed per-item
            break;

          case 'th':
          case 'td':
            // Push cell content to parent row
            pushText(`| ${content} `);
            break;

          case 'tr': {
            // Close the row with a trailing pipe
            const rowContent = state.content;
            flushLine(rowContent + '|');
            break;
          }

          case 'thead': {
            // After thead, insert separator row
            const headerContent = state.content;
            if (headerContent) pushText(headerContent);
            // Count columns by pipes in the last header row
            const lastLine = lines[lines.length - 1] ?? '';
            const cols = (lastLine.match(/\|/g)?.length ?? 1) - 1;
            if (cols > 0) {
              const sep = '|' + ' --- |'.repeat(cols);
              flushLine(sep);
            }
            break;
          }

          case 'tbody':
          case 'table':
            // Container, content already flushed
            if (state.content) pushText(state.content);
            break;

          case 'p':
            if (content) flushLine(content);
            flushLine('');
            break;

          case 'div':
            if (content) flushLine(content);
            break;

          default:
            if (content) pushText(content);
            break;
        }
      },
    },
    { decodeEntities: true },
  );

  parser.write(html);
  parser.end();

  // Post-process: collapse consecutive blank lines to max 2
  const result: string[] = [];
  let blankCount = 0;

  for (const line of lines) {
    if (line.trim() === '') {
      blankCount++;
      if (blankCount <= 2) {
        result.push('');
      }
    } else {
      blankCount = 0;
      result.push(line);
    }
  }

  return result.join('\n').trim();
}
