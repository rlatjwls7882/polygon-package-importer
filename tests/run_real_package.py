"""Read-only check a local Polygon ZIP: python tests/run_real_package.py <package.zip>"""
import sys, tempfile, pathlib, json, subprocess, zipfile
import xml.etree.ElementTree as ET
if len(sys.argv)!=2:
    raise SystemExit('Usage: python run_real_package.py <polygon-zip>')
zip_path=pathlib.Path(sys.argv[1])
root=pathlib.Path(__file__).resolve().parent
from helpers.xml import tree
with zipfile.ZipFile(zip_path) as z:
    xmls=[name for name in z.namelist() if name=='problem.xml' or name.endswith('/problem.xml')]
    if len(xmls)!=1: raise ValueError('Expected one problem.xml')
    descriptor=tree(ET.fromstring(z.read(xmls[0])))
with tempfile.TemporaryDirectory() as tmp:
    json_path=pathlib.Path(tmp)/'tree.json'
    json_path.write_text(json.dumps(descriptor),encoding='utf-8')
    subprocess.run(['node',str(root/'test_real_package.mjs'),str(zip_path),str(json_path)],check=True)
    subprocess.run(['node',str(root/'test_delta_real.mjs'),str(zip_path),str(json_path)],check=True)
