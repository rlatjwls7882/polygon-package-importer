"""Run the offline suite: python3 tests/run.py. Requires Node 22+ and Python 3.12+."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / 'tests'

def run(*args):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)

for path in sorted((ROOT / 'src').rglob('*.js')):
    run('node', '--check', path)
run(sys.executable, TESTS / 'test_structure.py')
run(sys.executable, TESTS / 'run_logic.py')
# These are run with generated fixtures, or require an explicitly supplied real ZIP.
with_arguments = {'test_logic.mjs', 'test_import_engine.mjs', 'test_popup.mjs',
                  'test_package.mjs', 'test_formats.mjs', 'test_real_package.mjs', 'test_delta_real.mjs'}
for path in sorted(TESTS.glob('test_*.mjs')):
    if path.name not in with_arguments:
        run('node', path)
print('ALL_OFFLINE_TESTS_PASSED')
