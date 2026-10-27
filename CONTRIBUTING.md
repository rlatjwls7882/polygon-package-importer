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
`src/polygon/sync.js` orders the writes; its sibling modules handle their own content.
Source files are uploaded before judge selection; obsolete attachments are removed last.
The popup and offscreen HTML URLs, credential keys, and IndexedDB names stay stable.

## Problem formats

`judging/@run-count` maps to `runTwice` (1 or 2 only). The interactor asset enables
interactive judging; its `runs/run` text nodes select the interactive invocations.
Run 1 is required, and run 2 maps to `interactiveSecondRun`. The API's interactive-only
options are set after enabling interaction and reset before disabling it.

Subtask policies and dependency edges are read from `testset/groups`. Unknown groups,
duplicate names, cycles, invalid policies, empty groups, and inconsistent scores fail
before creating a Polygon problem. Group totals without per-test scores are supported
for `COMPLETE_GROUP`; `EACH_TEST` requires explicit per-test scores. Scores are validated
to hundredths. Changed dependency edges are cleared before replacing tests and restored
in topological order afterwards. Ungrouped tests and zero scores explicitly replace
old metadata. Group and judging settings are read back before committing.

Statement sample files (`example.N`, `.a`, `.mu`) take precedence over judge input/output.
A `.mu` sample enables interaction-log display. Different sample content for different
statement languages is rejected because the API stores one shared preview per test.

Only the default `tests` testset is supported; multiple testsets are not flattened.
Binary-only interactors and statement images remain unsupported. No compiler or judge
runs locally: this extension uploads the package to Polygon.

Format contracts: [Polygon API](https://codeforces.github.io/polygon-misc/API)
(`runTwice`, `interactiveSecondRun`, `saveTest`, `saveTestGroup`), native
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

ZIP reads use a 32 MiB per-archive LRU cache and share concurrent decompression.
Inflated data is bounded while streaming, checked by CRC32, and never cached on failure.
The 100 MiB ZIP limit is checked again by the uploader, not only by the popup.

File comparisons account for LF/CRLF-equivalent lengths. Tag-only solution updates
use the API's optional `file` parameter rather than downloading and re-uploading the
old main solution. API response parsing and backoff stay in the serialized request
queue; network errors on mutations are still not retried automatically.
