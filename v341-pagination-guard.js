'use strict';
(() => {
  const originalClick = HTMLElement.prototype.click;
  const OVERLAY_ID = 'dc-flipkart-analytics-overlay';

  const visible = element => {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };

  const disabled = element =>
    Boolean(element.disabled) ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.getAttribute('data-disabled') === 'true';

  const labelOf = element => [
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || '',
    element.textContent || ''
  ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();

  const isPaginationIntent = element => {
    const label = labelOf(element);
    return /\b(next page|go to next|load more|view more|show more)\b/.test(label) ||
      /^(next|›|»|>)$/.test(label);
  };

  const paginationContainer = element => element.closest(
    '[role="navigation"][aria-label*="pagination" i], nav[aria-label*="pagination" i], [class*="pagination" i], [data-testid*="pagination" i], [aria-label*="pagination" i]'
  );

  const associatedGrid = element => {
    const container = paginationContainer(element);
    if (container) {
      const ownerId = container.getAttribute('aria-controls') || element.getAttribute('aria-controls');
      if (ownerId) {
        const controlled = document.getElementById(ownerId);
        if (controlled?.matches('table,[role="grid"],[role="table"]')) return controlled;
      }
      const section = container.closest('section,article,main,[class*="table" i],[class*="grid" i]');
      const grid = section?.querySelector('table,[role="grid"],[role="table"]');
      if (grid) return grid;
    }
    const direct = element.closest('section,article,[class*="table" i],[class*="grid" i]')?.querySelector('table,[role="grid"],[role="table"]');
    return direct || null;
  };

  const gridFingerprint = grid => {
    if (!grid) return '';
    const rows = grid.querySelectorAll('tbody tr,[role="row"]').length;
    const text = (grid.innerText || grid.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 5000);
    return `${rows}|${text}`;
  };

  const validPaginationButton = element => {
    if (!(element instanceof HTMLElement)) return false;
    if (!isPaginationIntent(element) || !visible(element) || disabled(element)) return false;
    if (element.closest(`#${OVERLAY_ID},[role="dialog"],.carousel,.wizard`)) return false;
    const container = paginationContainer(element);
    const grid = associatedGrid(element);
    if (!grid) return false;
    if (!container && !element.getAttribute('aria-controls')) return false;
    return true;
  };

  HTMLElement.prototype.click = function guardedClick() {
    if (!isPaginationIntent(this)) return originalClick.call(this);
    if (!validPaginationButton(this)) {
      this.dispatchEvent(new CustomEvent('dc-fk-pagination-blocked', {
        bubbles: true,
        detail: { reason: 'unassociated-or-invalid-pagination-control' }
      }));
      return;
    }

    const grid = associatedGrid(this);
    const before = gridFingerprint(grid);
    this.dataset.dcFkPaginationBefore = before;
    originalClick.call(this);

    let checks = 0;
    const timer = setInterval(() => {
      checks += 1;
      const currentGrid = associatedGrid(this) || grid;
      const changed = gridFingerprint(currentGrid) !== before;
      if (changed || checks >= 20) {
        clearInterval(timer);
        this.dispatchEvent(new CustomEvent('dc-fk-pagination-result', {
          bubbles: true,
          detail: {
            changed,
            checks,
            associated: Boolean(currentGrid),
            label: labelOf(this)
          }
        }));
      }
    }, 300);
  };
})();
