/**
 * Returns a JavaScript code string to be executed via Runtime.evaluate
 * that cleans the DOM by removing non-essential elements.
 */
export function getDomFilterScript(): string {
  return `
    (() => {
      // Remove non-content elements
      const removeTags = ['script', 'style', 'noscript', 'link[rel="stylesheet"]', 'meta'];
      for (const sel of removeTags) {
        document.querySelectorAll(sel).forEach(el => el.remove());
      }

      // Remove decorative SVGs (those without meaningful content)
      document.querySelectorAll('svg').forEach(svg => {
        const role = svg.getAttribute('role');
        const ariaLabel = svg.getAttribute('aria-label');
        const ariaLabelledBy = svg.getAttribute('aria-labelledby');
        if (role !== 'img' && !ariaLabel && !ariaLabelledBy) {
          svg.remove();
        }
      });

      // Remove hidden elements (scoped to body to preserve head elements like <title>)
      document.body.querySelectorAll('[aria-hidden="true"]').forEach(el => el.remove());

      document.body.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          el.remove();
        }
      });

      return document.body.innerHTML;
    })()
  `;
}
