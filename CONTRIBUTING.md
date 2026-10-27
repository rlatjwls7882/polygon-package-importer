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

## Extending problem support

The current import plan and default `tests` testset restriction are unchanged.
This refactor does not claim full two-step, interactive, or subtask compatibility.

- Judging modes: extend `package/judging.js`, `polygon/judging.js`, and `polygon/compare.js` together. Judge sources are read in `package/assets.js`.
- Tests and subtask dependencies: extend `package/tests.js`, `polygon/tests.js`, and `polygon/groups.js` together. Do not infer dependency edges from declaration order.
- Add a descriptor in `tests/fixtures` and test both parsing and the API write sequence before enabling a new format. The current fixtures cover batch, interactor sources, independent/dependent groups, and checker/validator tests.

Check the [Polygon API documentation](https://codeforces.github.io/polygon-misc/API) when adding fields. `runTwice` and `interactiveSecondRun` are API fields, not yet mapped by this importer. Do not guess their XML representation.

Keep UI messages in both `_locales/en/messages.json` and `_locales/ko/messages.json`.
Offscreen documents load the bundled catalog through `chrome.runtime.getURL` because they do not expose `chrome.i18n`.
`tests/test_structure.py` checks import paths, dependency cycles, and layer boundaries.
The release scripts use the same runtime allowlist and verify every packaged source file.
