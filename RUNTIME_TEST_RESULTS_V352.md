# Ecom Insight v3.5.2 Runtime Test Results

## Status

**NOT RUN — authenticated Chrome session required.**

This file is separate from `V352_VALIDATION.txt`. It must contain observed Chrome results only.

## Clean test-run setup

Run in the authenticated Flipkart Seller Hub page console:

```js
window.dispatchEvent(new CustomEvent('dc-fk-runtime-test-run-start'));
```

After all test cases, request the report:

```js
window.addEventListener('dc-fk-runtime-report', event => {
  console.log('Ecom Insight v3.5.2 runtime report', event.detail);
}, { once: true });
window.dispatchEvent(new CustomEvent('dc-fk-runtime-report-request'));
```

To discard the current sequence and begin a new clean run:

```js
window.dispatchEvent(new CustomEvent('dc-fk-runtime-test-run-reset'));
```

## Test cases

| Test | Expected result | Actual result | Status |
|---|---|---|---|
| Reload extension while Seller Hub tab remains open | Old launcher shows reload notice; toolbar gives red `!` feedback; no uncaught Ecom Insight error | Pending | NOT RUN |
| Open from page launcher after tab refresh | Dashboard opens once; source is `page-launcher` | Pending | NOT RUN |
| Open from Chrome toolbar | Dashboard opens once; source is `toolbar` | Pending | NOT RUN |
| Complete full sync | One started and one terminal finished summary use the same `runId` and `syncId` | Pending | NOT RUN |
| Cancel midway | Cancel lifecycle completes; restore count is exactly one only when `requiresRestore=true` | Pending | NOT RUN |
| Interrupted sync reconciliation | Refresh after an abandoned sync; unmatched stale summary becomes `interrupted` after grace period | Pending | NOT RUN |
| Completed fallback cleanup | Completed session fallback migrates to Chrome storage and is then removed from sessionStorage | Pending | NOT RUN |
| Persistence quality | `persistenceDegraded=false` for certified syncs | Pending | NOT RUN |
| Diagnostics resilience | No migrated `diagnostics-write-failure` entries for the test run | Pending | NOT RUN |
| Runtime report | `certificationPassed=true`, `hasCompletedTestSync=true`, `allStartedSyncsFinished=true` | Pending | NOT RUN |
| Extension errors | `confirmedExtensionErrorCount=0`; probable warnings reviewed separately | Pending | NOT RUN |

## Evidence to paste here

- Chrome version:
- Extension commit/version:
- Test runId:
- Runtime report JSON:
- Seller Hub page-console errors:
- `chrome://extensions` error view:
- Screenshots or timestamps:

No PASS status should be entered without observed evidence from the authenticated Chrome session.
