"""Validate plain-text Chrome Web Store descriptions before publishing."""
from pathlib import Path
root = Path(__file__).resolve().parents[1] / 'store-assets'
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
