"""Files allowed in the unpacked extension and release ZIP."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def extension_files():
    files = ['manifest.json', 'popup.html', 'offscreen.html', 'LICENSE']
    for directory, suffixes in [('src', {'.js', '.css'}), ('_locales', {'.json'}), ('icons', {'.png'})]:
        for path in sorted((ROOT / directory).rglob('*')):
            if path.is_symlink():
                raise ValueError(f'Symlinks are not packaged: {path}')
            if path.is_file():
                if path.suffix not in suffixes:
                    raise ValueError(f'Unexpected runtime file: {path}')
                files.append(path.relative_to(ROOT).as_posix())
    for name in files:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing or unsafe extension file: {name}')
    return sorted(files)
