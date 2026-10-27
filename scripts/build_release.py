"""Build a reproducible Chrome Web Store ZIP containing runtime files only."""
import json
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from extension_files import ROOT, extension_files

version = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
output = ROOT / 'dist' / f'polygon-zip-uploader-v{version}.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for name in extension_files():
        entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, (ROOT / name).read_bytes(), compresslevel=9)
with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise ValueError('Invalid ZIP output')
print(f'Created: {output} ({output.stat().st_size:,} bytes)')
