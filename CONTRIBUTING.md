# Development

Requires Node.js 22+ and Python 3.12+. No npm install or bundler is needed.
Load the repository root as an unpacked extension.

```sh
python3 tests/run.py
python3 scripts/check_listing.py
python3 scripts/build_release.py
python3 scripts/check_release.py
```

## Code layout

| Directory | Responsibility |
| --- | --- |
| `src/ui` | Popup and API-key controls |
| `src/runtime` | Service worker, offscreen upload, progress messages |
| `src/storage` | Encrypted credentials, legacy migration, staged ZIPs |
| `src/package` | ZIP/XML readers, statements, assets, judging, tests, validation |
| `src/polygon` | API requests, target snapshot, import orchestration, per-feature synchronization |
| `tests/fixtures`, `tests/helpers` | Sample descriptors and shared browser/XML doubles |
| `scripts` | Listing checks and release packaging |

`src/package/load.js` reads the ZIP into an import plan. It never calls Polygon.
`src/polygon/import.js` owns target checks, creation, resume callbacks, and commit.
`src/polygon/verify.js` pins and follows a server build. Pure invocation, package,
descriptor checks, and durable checkpoint validation live in `src/polygon/verification/`.
File synchronization owns writes; `polygon/file-metadata.js` independently checks the
required remote namespaces and stops before a second read if the first one fails.
`src/package/zip.js` owns archive lifetime; `zip-directory.js` parses metadata and
`zip-contents.js` owns bounded decompression, streams, and the cache.
`src/ui/package-analysis.js` cancels superseded analyses; `runtime/status.js` persists
status without repeating identical progress writes.
`ui/popup.js` only mounts `popup-controller.js`. View-owned DOM/storage subscriptions
are disposed together through `ui/lifetime.js`; credential refreshes are coalesced.
`polygon/request-session.js` owns serialized requests, response timers and abortable
cooldowns. `api.js` retains signing, API semantics, pacing and retry policy.
`src/polygon/sync.js` orders the writes; its sibling modules handle their own content.
Source files are uploaded before judge selection; obsolete attachments are removed last.
`src/polygon/snapshot.js` validates remote lists and settings before they become
an overwrite plan. `src/storage/database.js` owns connection/transaction completion;
`src/package/text.js` shares EOL comparison and UTF-8 length bounds without full copies.
The popup and offscreen HTML URLs, credential keys, and IndexedDB names stay stable.

## Problem formats

Imports always enable `wellFormed`, even if the source ZIP says false or omits
`tests-wellformed`. This is an intentional policy override, not source metadata
preservation. Existing targets are repaired when necessary; an already true flag
needs no extra update. The API read-back and built XML must both confirm true.
Built descriptors are checked directly, never through the normalized import plan.

`judging/@run-count` maps to `runTwice` (1 or 2 only). The interactor asset enables
interactive judging; its `runs/run` text nodes select the interactive invocations.
Run 1 is required, and run 2 maps to `interactiveSecondRun`. The API's interactive-only
options are set after enabling interaction and reset before disabling it.

Subtask policies and dependency edges are read from `testset/groups`. Unknown groups,
duplicate names, cycles, invalid policies, empty groups, and inconsistent scores fail
before creating a Polygon problem. Group totals without per-test scores are supported
for `COMPLETE_GROUP`; `EACH_TEST` requires explicit per-test scores. Scores are validated
to hundredths. Changed dependency edges are cleared before replacing tests and restored
in topological order afterwards. When hidden groups may be affected by test
replacement, their dependencies are temporarily exposed and cleared before deletion;
the requested disabled mode is restored even on an error. Ungrouped tests and zero scores explicitly replace
old metadata. Group and judging settings are read back before committing.

Group-only edits with a non-empty destination are batched by group through
`problem.setTestGroup(testIndices=...)`. Manual and generated test indices share
one batch after any script rebuild. New manual tests, group clearing, and edits
that also change input, points, description, or samples keep a single `saveTest`
request. Batch failures stop the import; retry reads the current remote state and
sends only remaining differences. The existing read-back check covers batched edits.

Statement sample files (`example.N`, `.a`, `.mu`) take precedence over judge input/output.
Sample numbers accept leading zeroes; conflicting aliases or orphan samples fail preflight.
A `.mu` sample enables interaction-log display. Different sample content for different
statement languages is rejected because the API stores one shared preview per test.

Only the default `tests` testset is supported; multiple testsets are not flattened.
Exactly one main solution is required. Multiple validators (including extra validators
already selected on an overwrite target) are rejected: the public API has no setter
for that configuration. Binary-only interactors and statement images remain unsupported.
No downloaded compiler or source is run locally.

Original ZIP compiler identifiers, filenames, paths and source bytes are preserved.
At the API boundary only, generic `cpp.g++20` maps to Polygon's
`cpp.gcc13-64-winlibs-g++20`, and `cpp.g++23` maps to
`cpp.gcc14-64-msys2-g++23`. Each resolution is reported once in the import log;
the C++ standard is not downgraded. The explicit IDs are used for source files,
solutions, exact grader `forTypes`, metadata read-back and built-descriptor checks.
Concrete native compiler IDs remain exact; unknown IDs and uncertain write failures
are not retried using a default or another compiler. The ZIP itself is never rewritten.
Compiler references: [rbx Polygon C++20 mapping](https://rbx.rsalesc.dev/setters/cheatsheet/)
and [Polygon C++23 identifier](https://codeforces.com/blog/entry/133919).
Resource `forTypes`/`stages`/`assets` linkage supports the API's COMPILE/SOLUTION subset;
other configurations are refused before uploading. Validator self-tests retain group
and testset context. Changed/obsolete judge tests are deleted before replacement.
Public preview bodies, compiler metadata, and judge self-tests are read back before commit.

The API has no documented current getter for checker-percentage mode or solution extra
tags. Scored problems therefore explicitly set/reset percentage mode; overwrites reconcile
extra tags for the known testset/group scopes. These requests are not counted as a data
no-op. Other unchanged files/tests still avoid writes, and group-only edits remain batched.
The built descriptor and invocation snapshots verify these otherwise opaque settings.

Format contracts: [Polygon API](https://codeforces.github.io/polygon-misc/API)
(`runTwice`, `interactiveSecondRun`, `saveTest`, `setTestGroup`, `saveTestGroup`), native
[run-count descriptor](https://github.com/noisg/sg_noi_archive/blob/d44b1d5964f609ccc13ac76f935e700fb9b794fb/2022_qualification/lboard/problem.xml),
and [interactor run parsing](https://github.com/Niobium-41-nb/p2h/blob/72a3335158d51b8e056b9324fc5569d9bc7afd81/polygon_tests.py).
The synthetic fixtures exercise the formats and their combinations; the stateful API
double rejects wrong request ordering and injects failures before/after writes.
These tests do not replace a live upload smoke test.

Keep UI messages in both `_locales/en/messages.json` and `_locales/ko/messages.json`.
Offscreen documents load the bundled catalog through `chrome.runtime.getURL` because they do not expose `chrome.i18n`.
`tests/test_structure.py` checks import paths, dependency cycles, and layer boundaries.
The release scripts use the same runtime allowlist and verify every packaged source file.

## Import reliability

Runtime commands and status writes are serialized. Each attempt has a nonce; late
messages cannot finish a newer retry. A running job claims its IndexedDB record,
and compare/delete uses one transaction, so another popup cannot replace its ZIP.
Job metadata and its ZIP are separate records in the same store/transaction; locks,
status queries, and verification checkpoints never reload or re-save the payload.
Old inline-Blob jobs migrate lazily on mutation without changing database identities.
A blocked open that later succeeds is closed, and connections yield on version changes.
Read results are returned only after transaction completion. Initial encryption-key
creation uses a read/check/write transaction, so concurrent first saves cannot encrypt
with different keys while retaining only one. Temporary plaintext byte buffers are
cleared in `finally`; JavaScript strings are not guaranteed to be erasable.

ZIP reads use a 32 MiB per-archive LRU cache and deduplicate concurrent reads.
At most two entries inflate at once, within a 32 MiB declared-output budget; a larger
allowed entry runs alone. This bounds in-flight allocation, not the browser's total heap.
Native File/Blob reads also use a cancellable stream and verify the declared size;
non-stream test adapters still use `arrayBuffer()`. Every owner disposes its archive in `finally`; disposal cancels active streams, rejects
queued reads, removes abort listeners and releases the compressed buffer/cache.
Decoded caches and old remote snapshots are released before polling a server build.
Inflated data is bounded while streaming, checked by CRC32, and never cached on failure.
The 100 MiB ZIP limit is checked by the popup/uploader and while downloading build ZIPs.

Overwrite eligibility (stress tests and extra validators) is checked before test
input/statement bodies. Snapshot reads stop at the first error instead of queuing
unused downloads. Duplicate identities and malformed lists/settings fail before writes.

File comparisons account for LF/CRLF-equivalent lengths without allocating normalized
copies, a whole UTF-8 buffer, or an array of lines. Supplementary characters and lone
surrogates follow TextEncoder's length semantics. Tag-only solution updates
use the API's optional `file` parameter rather than downloading and re-uploading the
old main solution. An explicit `file: Field should not be empty` validation error
falls back to the original source; network errors do not trigger this fallback.
API response parsing and backoff stay in the serialized request
queue; network errors on mutations are still not retried automatically.
Discarded HTTP bodies are cancelled, request timers are cleared after body consumption,
and queue tails do not retain response values. Offscreen completion disposes its API
session; a failed startup closes the unused document but keeps the retryable ZIP.
Closing an API session also interrupts rate-limit delays and rejects queued calls.
JSON responses are limited to 256 MiB, raw source responses to 128 MiB, and non-OK
error bodies to 64 KiB while streaming. Oversize responses stop without retrying an
uncertain mutation. These bounds limit retained payload, not total browser memory.

Popups explicitly unregister listeners and cancel local analysis on `pagehide` without
cancelling an already-started background upload. Late queries/decryptions cannot replace
newer status or newly saved credential records. Credential encryption and persisted key formats are unchanged.

Offline comparison with an older checkout:

```sh
node tests/benchmark_import.mjs /path/to/baseline-checkout
node tests/benchmark_lifecycle.mjs /path/to/baseline-checkout
node tests/benchmark_request_resources.mjs /path/to/baseline-checkout
node tests/benchmark_preflight.mjs /path/to/baseline-checkout
node tests/benchmark_verification_work.mjs /path/to/baseline-checkout
POLYGON_RANDOM_CASES=3000 node tests/test_random_formats.mjs
```

This reports request counts, uploaded source bytes, decompression counts, and local
ZIP timings using synthetic data. The lifecycle comparison counts simultaneous inflations,
Blob-bearing storage writes, duplicate status writes, result downloads and planning reads.
These are operation counts, not live server latency, physical disk writes or browser RSS.

## Build and execution verification

New uploads enable **Build and test after committing** by default. Turning off commit
also turns off this option. Upload-only jobs say **execution not checked**, never verified.

1. Save and compare readable metadata; abort without committing on a mismatch.
2. Commit the working copy. Polygon package readiness requires a clean revision.
3. Persist a checkpoint, start `buildPackage(full=false, verify=true)`, and pin the new
   package ID/revision. A lost response is resolved from the pre-build package list;
   ambiguous candidates stop instead of guessing or launching a second build.
4. Require a READY package without a comment, a FINISHED invocation without tag violations,
   and one terminal run per expected solution/test pair. Missing runs, CE/FL, aborted runs,
   mismatched expectation tags, and changed revisions never count as verified.
5. Download that package's standard ZIP and compare its descriptor, compiler types,
   grader linkage, extra tags, and uploaded source/resource bytes with the selected ZIP.

Verification polls every five seconds for at most 360 checks. Running invocations use
summary responses; detailed solution/test runs are fetched only after FINISHED. Timeout is **incomplete**,
not success. Coverage uses indexed solution/test pairs and a bounded bitmap rather than
one allocated string per run. All runs are inspected, so an unfinished result cannot
hide a later compilation error or malformed verdict. Retry follows the stored build without re-uploading or committing again.
Changed working copies/revisions require selecting the ZIP again; terminal build failures
remain failures. A failed verification does not undo the already completed commit.
Build output uses the same 100 MiB ZIP and decompression limits as imported archives;
large outputs fail explicitly instead of skipping the descriptor check.

Tests model the documented API and use real XML parsing for round-trip fixtures. They
inject failures, corrupt read-backs, missing runs, stale revisions, and lost build responses.
They do not claim live Polygon compatibility or actual compiler execution.

### Verification work and retained state

A launch checkpoint keeps prior package IDs only until the new package is identified.
Pinned checkpoints drop that history; older pinned records migrate without creating a
new package. Malformed checkpoints fail before package queries, and a missing pinned
build never launches a replacement automatically. Cached reports are never trusted.

Verification rechecks the clean revision before downloading finished invocation details
and the ZIP, every 12 polling rounds while waiting, and after comparing the descriptor.
The periodic check adds a small read but stops obsolete jobs instead of wasting the
entire poll budget. Partial and final validation remain mandatory.

Package validation memoizes only validity/NUL facts per referenced path, not decoded
content. Shared test/sample/self-test paths are decoded once within that pass even
when archive caching is disabled or a file is too large to retain in the LRU cache.
Asset NUL checks and per-test error contexts are preserved.
