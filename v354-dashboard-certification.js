'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const embedded = params.get('embedded') === '1';
  if (!embedded || !token) return;

  function send(type, payload = {}) {
    parent.postMessage({ source: 'DC_FK_DASHBOARD', token, type, payload }, '*');
  }
  function notice(text, ok = true) {
    const el = document.getElementById('runtimeTestStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.state = ok ? 'ok' : 'error';
  }

  const panel = document.createElement('article');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-head"><div><h3>Runtime Certification</h3><small>Trusted test-run controls for this embedded Seller Hub session.</small></div><span id="runtimeTestStatus">Ready</span></div>
    <div class="settings-actions">
      <button id="runtimeStart" class="primary">Start Test Run</button>
      <button id="runtimeReset" class="secondary">Reset Run</button>
      <button id="runtimeEnd" class="secondary">End Run</button>
      <button id="runtimeReport" class="secondary">Generate Report</button>
    </div>
    <pre id="runtimeReportOutput">No report generated.</pre>`;
  const settings = document.getElementById('settings');
  if (settings) settings.prepend(panel);

  document.getElementById('runtimeStart')?.addEventListener('click', () => send('RUNTIME_TEST_RUN_START'));
  document.getElementById('runtimeReset')?.addEventListener('click', () => send('RUNTIME_TEST_RUN_RESET'));
  document.getElementById('runtimeEnd')?.addEventListener('click', () => send('RUNTIME_TEST_RUN_END'));
  document.getElementById('runtimeReport')?.addEventListener('click', () => send('RUNTIME_TEST_REPORT_REQUEST'));

  addEventListener('message', event => {
    const data = event.data || {};
    if (data.source !== 'DC_FK_HOST' || data.token !== token) return;
    if (data.type === 'RUNTIME_TEST_CONTROL_RESULT') {
      notice(data.payload?.accepted ? `${data.payload.action} accepted` : `${data.payload.action} rejected: ${data.payload.reason || 'unknown'}`, Boolean(data.payload?.accepted));
    }
    if (data.type === 'RUNTIME_TEST_REPORT') {
      const out = document.getElementById('runtimeReportOutput');
      if (out) out.textContent = JSON.stringify(data.payload, null, 2);
      notice(data.payload?.certificationPassed ? 'Certification passed' : 'Certification not passed', Boolean(data.payload?.certificationPassed));
    }
  });
})();
