# Ecom Insight v3.5.1 Runtime Test Results

## Status

**NOT RUN — authenticated Chrome session required.**

This file intentionally contains no fabricated PASS claims. The source changes are recorded in `V351_VALIDATION.txt`; authenticated Seller Hub behavior must be observed in the user's Chrome session.

## Test cases

| Test | Expected result | Actual result | Status |
|---|---|---|---|
| Reload extension while Seller Hub remains open | Old launcher shows reload notice; toolbar shows failure badge/title; no uncaught Ecom Insight error | Pending user Chrome run | NOT RUN |
| Open from page launcher after refresh | Dashboard opens once; source is `page-launcher` | Pending user Chrome run | NOT RUN |
| Open from Chrome toolbar | Dashboard opens once; source is `toolbar` | Pending user Chrome run | NOT RUN |
| Run complete sync | One start and one terminal finish share the same `syncId` and `runId` | Pending user Chrome run | NOT RUN |
| Cancel midway | Cancel lifecycle completes; restore count follows `requiresRestore` and never exceeds one | Pending user Chrome run | NOT RUN |
| Allow a real stalled sync to time out | Timeout finishes once and restores only after durable persistence | Pending user Chrome run | NOT RUN |
| Request current-run report | `hasCompletedTestSync=true`, `allStartedSyncsFinished=true`, `exactlyOneRestorePerRequiredSync=true`, `extensionErrorCount=0` | Pending user Chrome run | NOT RUN |
| Check page and extension consoles | No Ecom Insight extension errors | Pending user Chrome run | NOT RUN |

## Runtime report command

Run in the Seller Hub page console after completing the tests:

```js
window.addEventListener('dc-fk-runtime-report', event => {
  console.log('Ecom Insight v3.5.1 runtime report', event.detail);
}, { once: true });
window.dispatchEvent(new CustomEvent('dc-fk-runtime-report-request'));
```

Paste the observed report here and replace each pending result only after the corresponding browser test has actually run.
