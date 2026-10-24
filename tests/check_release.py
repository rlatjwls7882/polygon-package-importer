"""Check extension manifest, HTML bindings and packaged files."""
from html.parser import HTMLParser
from pathlib import Path
from zipfile import ZipFile
import json
import re

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']

class IDs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.names = set()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        value = dict(attrs)
        if 'id' in value:
            self.names.add(value['id'])
        if tag == 'script' and value.get('src'):
            self.sources.append(value['src'])

def parse_html(name):
    parser = IDs()
    parser.feed((root / name).read_text(encoding='utf-8'))
    return parser

popup = parse_html('popup.html')
options = parse_html('index.html')
offscreen = parse_html('offscreen.html')

def used_ids(name):
    js = (root / name).read_text(encoding='utf-8')
    return set(re.findall(r"\$\('([^']+)'\)", js))

popup_missing = used_ids('popup.js') - popup.names
option_missing = used_ids('credentials-ui.js') - options.names
assert not popup_missing, f'Popup UI references missing: {popup_missing}'
assert not option_missing, f'Options UI references missing: {option_missing}'
assert manifest['action']['default_popup'] == 'popup.html'
assert manifest['options_ui']['page'] == 'index.html'
assert manifest['background']['type'] == 'module'
assert set(['storage', 'offscreen']).issubset(manifest['permissions'])
assert manifest['host_permissions'] == ['https://polygon.codeforces.com/*']
assert 'id="pin"' not in (root / 'index.html').read_text(encoding='utf-8')
assert 'popup.js' in popup.sources
assert 'settings.js' in options.sources
assert 'offscreen.js' in offscreen.sources

package = root / 'dist' / f'polygon-package-importer-v{version}.zip'
with ZipFile(package) as archive:
    sources = set(archive.namelist())
    packed = json.loads(archive.read('manifest.json'))
    assert packed['version'] == version
    assert archive.testzip() is None
    assert {'popup.html', 'index.html', 'offscreen.html', 'job-store.js',
            'polygon-import.js', 'credential-store.js', 'status.js'}.issubset(sources)
    assert 'importer.html' not in sources and 'importer.js' not in sources
    assert 'class="progress"' not in archive.read('popup.html').decode('utf-8')
    for name in sources:
        if name.endswith('.js'):
            text = archive.read(name).decode('utf-8')
            for imported in re.findall(r"from\s+['\"]\./([^'\"]+)['\"]", text):
                assert imported in sources, f'{name} imports a missing file: {imported}'
    print('RELEASE_OK', version, len(sources), 'files,', package.stat().st_size, 'bytes')

print('UI_BINDINGS_OK popup', len(popup.names), 'settings', len(options.names))
