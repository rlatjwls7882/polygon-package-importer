"""Build a Chrome Web Store upload ZIP from extension runtime files only."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))['version']
output = root / 'dist' / f'polygon-zip-uploader-v{version}.zip'
output.parent.mkdir(exist_ok=True)

files = [
    'manifest.json', 'background.js', 'popup.html', 'popup.js', 'popup.css',
    'index.html', 'settings.js', 'style.css', 'offscreen.html', 'offscreen.js',
    'polygon-import.js', 'job-store.js', 'status.js',
    'api.js', 'sync.js', 'zip.js', 'model.js',
    'credential-store.js', 'credential-vault.js', 'credentials-ui.js',
    'LICENSE',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'
]

with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for name in files:
        path = root / name
        if not path.is_file():
            raise FileNotFoundError(path)
        archive.write(path, name)

with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise ValueError('Invalid ZIP output')

print(f'Created: {output} ({output.stat().st_size:,} bytes)')
