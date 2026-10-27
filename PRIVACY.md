# Privacy Policy

[한국어](PRIVACY.ko.md) · Updated October 27, 2026

Polygon ZIP Uploader is an unofficial Chrome extension for importing problem packages into Codeforces Polygon.

## Data stored on your device

- Polygon API Key and Secret are encrypted with AES-256-GCM in `chrome.storage.local`. A non-extractable decryption key is kept in IndexedDB in the same Chrome profile.
- Your selected ZIP is held temporarily in IndexedDB during upload. It is deleted after a successful upload; failed jobs are retained until retried or cleared.
- Job details (filename, problem ID, status, and recent log) are stored locally. Logs are sanitized to avoid displaying API credentials.

## Data sent to Polygon

Only when you start an upload, the extension sends requests to `https://polygon.codeforces.com`. These include your API Key, API signatures, and package content needed to create or update the problem. The raw API Secret is not sent.

There are no analytics, advertising trackers, developer-operated collection servers, or data sales.

## Deletion and limits

Delete saved keys under **API keys → Delete**. Clear a completed or failed upload using **Clear**. Uninstalling the extension removes its local extension data. These actions do not remove content already uploaded to Polygon.

Encryption does not protect against malware controlling your browser profile. Do not use an untrusted shared computer for private API credentials.

[Contact via GitHub Issues](https://github.com/rlatjwls7882/polygon-package-importer/issues).
