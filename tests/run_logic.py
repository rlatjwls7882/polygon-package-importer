"""Offline ZIP/model/API unit tests. Requires Node 22+ and Python 3."""
import tempfile, zipfile, json, pathlib, subprocess
import xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parent
HASH='a'*64
META=f'files/soj-checkers/{HASH}/.checker-selection-v1'
MARKER=f'SOJ-CHECKER-SELECTION\t1\tbuiltin\twcmp\t{HASH}\n'
XML=(ROOT/'fixtures'/'batch.xml').read_text(encoding='utf-8')
from helpers.xml import tree

with tempfile.TemporaryDirectory() as d:
 d=pathlib.Path(d)
 entries={
    'problem.xml':XML,
    'statement-sections/english/name.tex':'Demo import',
    'statement-sections/english/legend.tex':'Test $n$.',
    'statement-sections/english/input.tex':'Read $n$.',
    'statement-sections/english/output.tex':'Print $n$.',
    'files/gen.cpp':'int main(){return 0;}',
    'files/val.cpp':'int main(){return 0;}',
    'files/sol.cpp':'int main(){return 0;}',
    'files/testlib.h':'// header',
    'files/extra/testlib.h':'// header',
    META:MARKER,
    'tests/01':'1\n',
    'tests/01.a':'1\n',
    'files/interactor.cpp':'int main(){return 0;}',
    'validator/01':'1\n',
    'checker/01':'1\n',
    'checker/01.out':'1\n',
    'checker/01.ans':'1\n',
 }
 def make_zip(name, overrides=None):
  contents=entries| (overrides or {})
  with zipfile.ZipFile(d/name,'w',zipfile.ZIP_DEFLATED) as z:
   for file,body in contents.items():z.writestr(file,body)
 make_zip('test.zip')
 make_zip('collision.zip',{'files/extra/testlib.h':'// different content'})
 make_zip('badmarker.zip',{META:MARKER.replace('wcmp','icmp')})
 bad_xml=XML.replace('<resources>','<resources><file path="files/.unknown-resource"/>')
 make_zip('badname.zip',{'problem.xml':bad_xml, 'files/.unknown-resource':'not metadata'})
 (d/'tree.json').write_text(json.dumps(tree(ET.fromstring(XML))))
 (d/'badname_tree.json').write_text(json.dumps(tree(ET.fromstring(bad_xml))))
 subprocess.run(['node',str(ROOT/'test_logic.mjs'),str(d/'test.zip'),str(d/'tree.json'),
                 str(d/'collision.zip'),str(d/'badmarker.zip'),str(d/'badname.zip'),
                 str(d/'badname_tree.json')],check=True)
 subprocess.run(['node',str(ROOT/'test_import_engine.mjs'),str(d/'test.zip'),str(d/'tree.json')],check=True)
 subprocess.run(['node',str(ROOT/'test_popup.mjs'),str(d/'test.zip'),str(d/'tree.json')],check=True)

 cases={}
 for fixture in sorted((ROOT/'fixtures').glob('*.xml')):
  xml=fixture.read_text(encoding='utf-8')
  make_zip(fixture.stem+'.zip',{'problem.xml':xml})
  cases[fixture.stem]=tree(ET.fromstring(xml))
 make_zip('bad-input.zip', {'tests/01':b'\xff'})
 make_zip('missing-generator.zip', {'problem.xml':XML.replace('gen 99','absent 99')})
 cases['bad-input']=cases['batch']
 cases['missing-generator']=tree(ET.fromstring(XML.replace('gen 99','absent 99')))
 make_zip('bad-self-test.zip', {'problem.xml':(ROOT/'fixtures/self-tests.xml').read_text(encoding='utf-8'), 'validator/01':b'\xff'})
 cases['bad-self-test']=cases['self-tests']
 (d/'cases.json').write_text(json.dumps(cases),encoding='utf-8')
 subprocess.run(['node',str(ROOT/'test_package.mjs'),str(d),str(d/'cases.json')],check=True)
