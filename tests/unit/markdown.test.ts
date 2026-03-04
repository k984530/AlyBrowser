import { describe, it, expect } from 'vitest';
import { convertHtmlToMarkdown } from '../../src/extractors/markdown';

describe('convertHtmlToMarkdown', () => {
  it('converts headings', () => {
    const html = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('# Title');
    expect(md).toContain('## Subtitle');
    expect(md).toContain('### Section');
  });

  it('converts paragraphs', () => {
    const html = '<p>Hello world</p><p>Second paragraph</p>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('Hello world');
    expect(md).toContain('Second paragraph');
  });

  it('converts bold and italic', () => {
    const html = '<p><strong>bold</strong> and <em>italic</em></p>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('**bold**');
    expect(md).toContain('*italic*');
  });

  it('converts links without refs', () => {
    const html = '<a href="https://example.com">Example</a>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('[Example](https://example.com)');
  });

  it('converts links with refs', () => {
    const html = '<a href="https://example.com">Example</a>';
    const refs = [{ ref: '@e1', role: 'link', name: 'Example', backendNodeId: 1 }];
    const md = convertHtmlToMarkdown(html, refs);
    expect(md).toContain('[@e1 link: "Example"](https://example.com)');
  });

  it('converts buttons with refs', () => {
    const html = '<button>Submit</button>';
    const refs = [{ ref: '@e1', role: 'button', name: 'Submit', backendNodeId: 1 }];
    const md = convertHtmlToMarkdown(html, refs);
    expect(md).toContain('[@e1 button: "Submit"]');
  });

  it('converts input elements', () => {
    const html = '<input type="search" placeholder="Search..." value="">';
    const refs = [{ ref: '@e1', role: 'searchbox', name: 'Search', backendNodeId: 1 }];
    const md = convertHtmlToMarkdown(html, refs);
    expect(md).toContain('@e1');
    expect(md).toContain('searchbox');
    expect(md).toContain('placeholder="Search..."');
  });

  it('converts unordered lists', () => {
    const html = '<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('- Item 1');
    expect(md).toContain('- Item 2');
    expect(md).toContain('- Item 3');
  });

  it('converts ordered lists', () => {
    const html = '<ol><li>First</li><li>Second</li></ol>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('1. First');
    expect(md).toContain('2. Second');
  });

  it('converts images', () => {
    const html = '<img src="photo.png" alt="A photo">';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('![A photo](photo.png)');
  });

  it('converts inline code', () => {
    const html = '<p>Use <code>console.log</code> to debug</p>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('`console.log`');
  });

  it('converts code blocks', () => {
    const html = '<pre><code>const x = 1;</code></pre>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });

  it('converts tables', () => {
    const html = `
      <table>
        <thead><tr><th>Name</th><th>Age</th></tr></thead>
        <tbody><tr><td>Alice</td><td>30</td></tr></tbody>
      </table>`;
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('| Name | Age |');
    expect(md).toContain('---');
    expect(md).toContain('| Alice | 30 |');
  });

  it('converts horizontal rule', () => {
    const html = '<p>Before</p><hr><p>After</p>';
    const md = convertHtmlToMarkdown(html);
    expect(md).toContain('---');
  });

  it('collapses excessive blank lines', () => {
    const html = '<p>A</p><p></p><p></p><p></p><p></p><p>B</p>';
    const md = convertHtmlToMarkdown(html);
    const blankRuns = md.match(/\n{3,}/g);
    // Should not have more than 2 consecutive blank lines (3 newlines)
    if (blankRuns) {
      for (const run of blankRuns) {
        expect(run.length).toBeLessThanOrEqual(3);
      }
    }
  });
});
