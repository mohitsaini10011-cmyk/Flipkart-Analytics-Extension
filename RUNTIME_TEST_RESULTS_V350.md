# Ecom Insight v3.5.0 Runtime Test Results

## Status

**Not executed yet.**

This file is intentionally separate from `V350_VALIDATION.txt`. Source-level checks do not prove authenticated Flipkart Seller Hub behavior.

## Required environment

- Google Chrome with the unpacked v3.5.0 extension loaded
- An authenticated Flipkart Seller Hub account
- Seller Hub DevTools console
- `chrome://extensions` extension error view

## Test cases

| Test | Expected result | Actual result | Status |
|---|---|---|---|
| Reload extension while Seller Hub tab remains open | Old page launcher shows reload notice; toolbar shows red `!` badge/title feedback; no uncaught extension-context error | Pending | NOT RUN |
| Open from page launcher after refreshing tab | Dashboard opens once and diagnostic source is `page-launcher` | Pending | NOT RUN |
| Open from Chrome toolbar | Dashboard opens once and diagnostic source is `toolbar` | Pending | NOT RUN |
| Run complete sync | One `sync-started` and one terminal `sync-finished` share the same `syncId` | Pending | NOT RUN |
| Cancel midway | `cancel-requested` is followed by `cancelled`; restore count for that `syncId` is 0 or 1 according to `requiresRestore` | Pending | NOT RUN |
| Allow a real stalled sync to time out | Timeout produces one terminal finish and exactly one restore only when required | Pending | NOT RUN |
| Request runtime report | `allStartedSyncsFinished=true`, `exactlyOneRestorePerRequiredSync=true`, `extensionErrorCount=0` | Pending | NOT RUN |
| Check page and extension consoles | No Ecom Insight extension errors | Pending | NOT RUN |

## Runtime report command

Run in the Seller Hub page console after the test sequence:

```js
window.addEventListener('dc-fk-runtime-report', event => {
  console.log('Ecom Insight runtime report', event.detail);
}, { once: true });
window.dispatchEvent(new CustomEvent('dc-fk-runtime-report-request'));
```

Copy the resulting report into this file and replace each `Pending / NOT RUN` entry with the observed result.
