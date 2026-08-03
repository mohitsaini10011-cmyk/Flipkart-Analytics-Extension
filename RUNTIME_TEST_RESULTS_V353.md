# Ecom Insight v3.5.3 Runtime Test Results

## Status

**NOT RUN — authenticated Chrome Seller Hub session required.**

This file contains observed runtime evidence only. Source-level fixes are documented separately in `V353_VALIDATION.txt`.

## Required test sequence

1. Load unpacked extension v3.5.3 and refresh the authenticated Seller Hub tab.
2. Open the embedded Ecom Insight dashboard.
3. From the dashboard, send a token-bearing `RUNTIME_TEST_RUN_START` message.
4. Open from the page launcher and Chrome toolbar.
5. Run one complete sync.
6. Run another sync and cancel midway.
7. Attempt start/reset/end while a sync is active; each must be rejected.
8. End the test run after all syncs are terminal.
9. Request the strict runtime report.
10. Check the Seller Hub page console and `chrome://extensions` error view.

## Expected certification gates

- `hasCompletedTestSync = true`
- `allStartedSyncsFinished = true`
- `noDuplicateRestores = true`
- `requiredRestoresComplete = true`
- `unnecessaryRestoresAbsent = true`
- `persistenceFailuresAbsent = true`
- `degradedPersistenceAbsent = true`
- `confirmedExtensionErrorCount = 0`
- `certificationPassed = true`

## Results

| Test | Actual result | Status |
|---|---|---|
| Trusted test-run start | Pending | NOT RUN |
| Untrusted page-event control rejected | Pending | NOT RUN |
| Active-sync start/reset/end rejected | Pending | NOT RUN |
| Launcher open | Pending | NOT RUN |
| Toolbar open | Pending | NOT RUN |
| Complete sync | Pending | NOT RUN |
| Midway cancellation | Pending | NOT RUN |
| Exactly-once restoration | Pending | NOT RUN |
| Strict error attribution | Pending | NOT RUN |
| Final certification report | Pending | NOT RUN |

## Evidence to add

- Chrome version:
- Extension commit/version:
- Seller Hub URL/module tested:
- Test runId:
- Runtime report JSON:
- Seller Hub page-console errors:
- `chrome://extensions` errors:
- Screenshots/timestamps:

No PASS status should be entered without observed evidence from the authenticated Chrome session.
