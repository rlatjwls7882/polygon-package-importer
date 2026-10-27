"""Validate the Chrome extension package and required Web Store assets."""
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile
import json
import re
import struct
import posixpath
from extension_files import extension_files

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']

class IDs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.names = set()
        self.sources = []
        self.styles = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get('id'):
            self.names.add(values['id'])
        if tag == 'script' and values.get('src'):
            self.sources.append(values['src'])
        if tag == 'link' and values.get('rel') == 'stylesheet':
            self.styles.append(values['href'])

def parse_html(name):
    parser = IDs()
    parser.feed((root / name).read_text(encoding='utf-8'))
    return parser

def used_ids(name):
    source = (root / name).read_text(encoding='utf-8')
    return set(re.findall(r"\$\('([^']+)'\)", source))

def png_dimensions(path):
    data = path.read_bytes()
    assert data.startswith(b'\x89PNG\r\n\x1a\n'), f'Not a PNG: {path}'
    return struct.unpack('>II', data[16:24])

popup = parse_html('popup.html')
offscreen = parse_html('offscreen.html')
assert not (used_ids('src/ui/popup-controller.js') - popup.names), 'Missing popup elements'
assert not (used_ids('src/ui/credentials.js') - popup.names), 'Missing API-key popup elements'

assert manifest['name'] == '__MSG_extensionName__'
assert manifest['description'] == '__MSG_extensionDescription__'
assert manifest['default_locale'] == 'en'
en_messages = json.loads((root / '_locales/en/messages.json').read_text(encoding='utf-8'))
assert en_messages['extensionName']['message'] == 'Polygon ZIP Uploader'
description = en_messages['extensionDescription']['message']
assert 1 <= len(description) <= 132 and 'local' in description.lower()
assert manifest['manifest_version'] == 3
assert manifest['action']['default_popup'] == 'popup.html'
assert 'options_ui' not in manifest, 'No separate settings page should open'
assert manifest['background']['type'] == 'module'
assert manifest['background']['service_worker'] == 'src/runtime/background.js'
assert set(['storage', 'offscreen']) == set(manifest['permissions'])
assert manifest['host_permissions'] == ['https://polygon.codeforces.com/*']
assert 'id="pin"' not in (root / 'popup.html').read_text(encoding='utf-8')
assert 'src/ui/popup.js' in popup.sources
assert 'src/ui/popup.css' in popup.styles
assert 'settings.js' not in popup.sources
assert 'src/runtime/offscreen.js' in offscreen.sources
assert (root / 'LICENSE').read_text(encoding='utf-8').startswith('MIT License')
assert png_dimensions(root / 'icons' / 'icon128.png') == (128, 128)
assert png_dimensions(root / 'store-assets' / 'store-icon-128.png') == (128, 128)

screenshots = sorted((root / 'store-assets' / 'screenshots').glob('*.png'))
assert screenshots, 'At least one real screenshot is required'
for path in screenshots:
    assert png_dimensions(path) in [(640, 400), (1280, 800)], path

package = root / 'dist' / f'polygon-zip-uploader-v{version}.zip'
with ZipFile(package) as archive:
    paths = set(archive.namelist())
    packed = json.loads(archive.read('manifest.json'))
    assert packed == manifest
    assert paths == set(extension_files()), 'Unexpected or missing packaged files'
    for name in paths:
        assert archive.read(name) == (root / name).read_bytes(), f'Stale packaged file: {name}'
    assert archive.testzip() is None
    assert {'popup.html', 'offscreen.html', 'src/storage/jobs.js',
            'src/polygon/import.js', 'src/storage/credentials.js', 'src/i18n.js',
            '_locales/en/messages.json', '_locales/ko/messages.json',
            'LICENSE', 'icons/icon128.png'}.issubset(paths)
    assert not any(path.startswith(('tests/', 'scripts/', '.github/', 'store-assets/')) for path in paths)
    assert 'importer.html' not in paths and 'importer.js' not in paths
    assert not {'index.html', 'settings.js', 'style.css'} & paths
    for name in paths:
        if name.endswith('.js'):
            contents = archive.read(name).decode('utf-8')
            for imported in re.findall(r"(?:from\s*|import\s*(?:\(\s*)?)[\"'](\.[^\"']+)[\"']", contents):
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), imported))
                assert resolved in paths, f'{name} imports missing file: {imported}'
    assert packed['background']['service_worker'] in paths
    for page, parsed in [('popup.html', popup), ('offscreen.html', offscreen)]:
        for source in parsed.sources + parsed.styles:
            assert source in paths, f'{page} references missing script: {source}'
    assert 'src/ui/popup.css' in paths

print('RELEASE_OK', version, len(paths), 'files,', package.stat().st_size, 'bytes')
print('UI_OK unified popup', len(popup.names), 'elements')
print('STORE_ASSETS_OK', len(screenshots), 'screenshots')
