# Ecom Insight v3.5.4 Runtime Test Results

## Status

**NOT RUN — authenticated Chrome Seller Hub session required.**

## Test sequence

1. Reload unpacked v3.5.4 and refresh the authenticated Seller Hub tab.
2. Open Ecom Insight → Settings → Runtime Certification.
3. Click Start Test Run and verify accepted acknowledgement.
4. Open dashboard from page launcher and Chrome toolbar.
5. Run a complete sync.
6. Start another sync and cancel midway.
7. During an active sync try Start, Reset and End; Start/Reset must reject and End must defer.
8. After all syncs terminate, click End Run.
9. Click Generate Report.
10. Check Seller Hub console and chrome://extensions errors.

## Required PASS gates

- testRun.status = ended
- hasCompletedTestSync = true
- allStartedSyncsFinished = true
- noDuplicateRestores = true
- requiredRestoresComplete = true
- unnecessaryRestoresAbsent = true
- persistenceFailuresAbsent = true
- degradedPersistenceAbsent = true
- diagnosticsWriteFailuresAbsent = true
- confirmedExtensionErrorCount = 0
- certificationPassed = true

## Observed results

| Test | Actual result | Status |
|---|---|---|
| Trusted Start acknowledgement | Pending | NOT RUN |
| Active-sync controls | Pending | NOT RUN |
| Launcher open | Pending | NOT RUN |
| Toolbar open | Pending | NOT RUN |
| Complete sync | Pending | NOT RUN |
| Midway cancellation | Pending | NOT RUN |
| Deferred End | Pending | NOT RUN |
| Exactly-once restoration | Pending | NOT RUN |
| Console/errors | Pending | NOT RUN |
| Final report | Pending | NOT RUN |

No PASS status should be entered without observed evidence from the authenticated Chrome session.
