"""Validate plain-text Chrome Web Store descriptions before publishing."""
from pathlib import Path
import json
import re

repo = Path(__file__).resolve().parents[1]
root = repo / 'store-assets'
for locale in ('ko', 'en'):
    summary = (root / f'summary-{locale}.txt').read_text(encoding='utf-8').strip()
    description = (root / f'description-{locale}.txt').read_text(encoding='utf-8').strip()
    assert 1 <= len(summary) <= 132, f'{locale} summary exceeds store limit'
    assert '\n' not in summary, f'{locale} summary must be a single line'
    assert 150 <= len(description) <= 16_000, f'{locale} description length invalid'
    assert 'Codeforces Polygon' in summary and 'Codeforces Polygon' in description
    for marker in ('**', '###', '```', '<br>', '<p>', '</p>'):
        assert marker not in description and marker not in summary, f'{locale} has formatting marker {marker}'
    assert ('백업' if locale == 'ko' else 'backup') in description.lower()
    assert ('공식' if locale == 'ko' else 'not affiliated') in description.lower()
    print('PASS', locale, 'summary', len(summary), 'chars, description', len(description), 'chars')

# Public product text describes the package format independently of its exporter.
public_text = set(repo.glob('*.md')) | set((repo / 'docs').rglob('*.md'))
public_text |= set(root.rglob('*.md')) | set((repo / '.github').rglob('*.md'))
public_text |= set(root.rglob('*.txt')) | set(repo.glob('*.html'))
public_text |= set((repo / '_locales').glob('*/messages.json'))
for path in sorted(public_text):
    text = path.read_text(encoding='utf-8')
    if path.suffix == '.json':
        text = '\n'.join(entry['message'] for entry in json.loads(text).values())
    assert not re.search('soj', text, re.IGNORECASE), (
        f'Use Polygon package terminology in {path.relative_to(repo)}')
print('PASS public Polygon package terminology:', len(public_text), 'files')
