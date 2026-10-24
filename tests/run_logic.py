"""Offline ZIP/model/API unit tests. Requires Node 22+ and Python 3."""
import tempfile, zipfile, json, pathlib, subprocess
import xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parent
HASH='a'*64
META=f'files/soj-checkers/{HASH}/.checker-selection-v1'
MARKER=f'SOJ-CHECKER-SELECTION\t1\tbuiltin\twcmp\t{HASH}\n'
XML='''<?xml version="1.0" encoding="UTF-8"?>
<problem short-name="demo-import">
<statements><statement language="english" charset="UTF-8"/></statements>
<files><executables><executable><source type="cpp.g++20" path="files/gen.cpp"/></executable></executables>
<resources><file path="files/testlib.h"/><file path="files/extra/testlib.h"/><file path="''' + META + '''"/></resources></files>
<assets><checker name="std::wcmp"/><validators><validator><source type="cpp.g++20" path="files/val.cpp"/></validator></validators>
<solutions><solution tag="main"><source type="cpp.g++20" path="files/sol.cpp"/></solution></solutions></assets>
<judging><testset name="tests"><time-limit>1000</time-limit><memory-limit>268435456</memory-limit>
<test-count>2</test-count><input-path-pattern>tests/%02d</input-path-pattern><answer-path-pattern>tests/%02d.a</answer-path-pattern>
<tests><test method="manual" sample="true"/><test method="generated" cmd="gen 99"/></tests>
</testset></judging><tags><tag value="implementation"/></tags></problem>'''

def tree(el):return {'tag':el.tag,'attributes':el.attrib,'text':el.text or '', 'children':[tree(x) for x in el]}
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
