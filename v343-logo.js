'use strict';
(() => {
  function installLogo() {
    const brand = document.querySelector('.side-brand');
    if (!brand || brand.dataset.ecomLogo === '1') return;
    brand.dataset.ecomLogo = '1';

    const oldMark = brand.querySelector('.cube');
    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icons/ecom-insight-logo.svg');
    logo.alt = 'Ecom Insight';
    logo.className = 'ecom-insight-logo';
    if (oldMark) oldMark.replaceWith(logo);
    else brand.prepend(logo);

    const title = brand.querySelector('b');
    const subtitle = brand.querySelector('small');
    if (title) title.textContent = 'Ecom Insight';
    if (subtitle) subtitle.textContent = 'Marketplace intelligence tools';

    if (!document.getElementById('ecomInsightLogoStyles')) {
      const style = document.createElement('style');
      style.id = 'ecomInsightLogoStyles';
      style.textContent = `
        .side-brand{align-items:center;gap:12px}
        .ecom-insight-logo{width:48px;height:48px;object-fit:contain;flex:0 0 48px;border-radius:12px;background:#fff;padding:3px;box-sizing:border-box}
        .side-brand b{font-size:17px;line-height:1.15}
        .side-brand small{margin-top:3px;display:block}
      `;
      document.head.appendChild(style);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installLogo, { once: true });
  else installLogo();
})();