# <img src="icons/icon48.png" width="32" height="32" alt=""> Polygon ZIP Uploader

[English](README.md) | [한국어](README.ko.md)

Create or update [Codeforces Polygon](https://polygon.codeforces.com) problems from a local Polygon-format problem-package ZIP.

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/polygon-zip-uploader/fhlocfeafcanblbeppffhdilbkblmdcn)

## Usage

1. Create an API Key and Secret in [Polygon settings](https://polygon.codeforces.com/settings).
2. Open the extension and save the keys.
3. Select a ZIP containing `problem.xml`. Choose **New problem**, or **Existing problem** and enter its ID.
4. Click **Upload to Polygon**.

Uploads continue after the popup closes. Failed uploads can be retried from the popup.

Supports two-step and interactive problems, including an interactive second run. Subtask scores, scoring policies, and dependencies are preserved.

By default, the extension commits the upload, then asks Polygon to build and run the solutions. **Uploaded** and **build/execution verified** are separate results. A failed build does not undo the commit; verification can be turned off.

## Before uploading

**Back up existing problems before updating them.** Files, tests, and statement attachments missing from the ZIP may be deleted. There is no automatic backup.

ZIP limit: **100 MB**. Only the default `tests` testset is supported. Binary files and new statement images cannot be uploaded.

[Report a bug](https://github.com/rlatjwls7882/polygon-package-importer/issues) · [Privacy](PRIVACY.md) · [Development](CONTRIBUTING.md) · [MIT license](LICENSE)

Not affiliated with Codeforces.
