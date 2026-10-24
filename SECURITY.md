# Security

If you find a vulnerability, do not post API keys, credentials, or working
exploit details in public issues.

Use GitHub's **Report a vulnerability** feature if it is enabled for this
repository. Otherwise, open an issue asking for a private contact method,
without including sensitive details.

Polygon ZIP Uploader stores encrypted API credentials in the local Chrome
profile. The extension can decrypt them to sign Polygon API requests, so
malware with access to that browser profile is outside its protection
boundary. Only install builds from sources you trust.
