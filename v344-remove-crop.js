'use strict';
(() => {
  function removeCropFeature() {
    const cropNav = document.querySelector('#nav [data-page="crop"]');
    const cropPage = document.getElementById('crop');
    const wasActive = Boolean(cropPage?.classList.contains('active'));

    cropNav?.remove();
    cropPage?.remove();

    document.querySelectorAll('[data-pdf-output], #cropPreviewBtn, #cropProcessBtn, #cropPdfInput').forEach(node => node.remove());

    if (wasActive) {
      document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
      document.getElementById('overview')?.classList.add('active');
      document.querySelectorAll('#nav button').forEach(button => button.classList.toggle('active', button.dataset.page === 'overview'));
      const title = document.getElementById('pageTitle');
      if (title) title.textContent = 'Overview';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeCropFeature, { once: true });
  } else {
    removeCropFeature();
  }

  const observer = new MutationObserver(removeCropFeature);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();