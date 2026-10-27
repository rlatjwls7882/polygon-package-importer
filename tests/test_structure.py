"""Check source dependencies, layer boundaries, and extension entry points."""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'src'
allowed = {
    'package': {'package', 'i18n.js'},
    'polygon': {'polygon', 'package', 'i18n.js'},
    'storage': {'storage', 'i18n.js'},
    'ui': {'ui', 'package', 'storage', 'i18n.js'},
    'runtime': {'runtime', 'polygon', 'storage', 'package', 'i18n.js'},
    'i18n.js': set(),
}
graph = {}
for path in sorted(SRC.rglob('*.js')):
    name = path.relative_to(SRC).as_posix()
    layer = name.split('/')[0]
    assert layer in allowed, f'Unknown source layer: {name}'
    graph[name] = []
    for spec in re.findall(r"(?:from\s*|import\s*(?:\(\s*)?)[\"']([^\"']+)[\"']", path.read_text(encoding='utf-8')):
        assert spec.startswith('.'), f'Runtime import must be local: {name} -> {spec}'
        target = (path.parent / spec).resolve()
        assert target.is_relative_to(SRC) and target.is_file(), f'Broken source import: {name} -> {spec}'
        dependency = target.relative_to(SRC).as_posix()
        assert dependency.split('/')[0] in allowed[layer], f'Invalid layer dependency: {name} -> {dependency}'
        graph[name].append(dependency)

visited, active = set(), set()
def visit(name):
    assert name not in active, f'Cyclic source dependency: {name}'
    if name in visited:
        return
    active.add(name)
    for dependency in graph[name]:
        visit(dependency)
    active.remove(name)
    visited.add(name)
for name in graph:
    visit(name)
manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
assert (ROOT / manifest['background']['service_worker']).is_file()
assert (ROOT / manifest['action']['default_popup']).is_file()
assert not list(ROOT.glob('*.js')), 'Keep runtime code in src/'
print('PASS: source imports, layer boundaries, acyclic dependencies and entry points')
