import { spawnSync } from 'node:child_process';
class Element {
  constructor(value) {
    this.localName=value.tag;this.attributes=value.attributes;
    this.children=value.children.map(child=>new Element(child));
    this.textContent=value.text+this.children.map(child=>child.textContent).join('');
  }
  getAttribute(name){return this.attributes[name]??null;}
  hasAttribute(name){return Object.hasOwn(this.attributes,name);}
}
export function installNativeTestParser() {
  globalThis.DOMParser=class {
    parseFromString(xml,type) {
      if(type!=='application/xml')throw Error('Expected XML');
      const result=spawnSync('python3',['-c',
        'import sys,json,xml.etree.ElementTree as E\ndef node(e):return {"tag":e.tag,"attributes":e.attrib,"text":e.text or "","children":[node(c) for c in e]}\nprint(json.dumps(node(E.fromstring(sys.stdin.read()))))'
      ],{input:xml,encoding:'utf8',maxBuffer:4*1024*1024});
      if(result.status!==0)return {querySelector:()=>({}),documentElement:null};
      return {querySelector:()=>null,documentElement:new Element(JSON.parse(result.stdout))};
    }
  };
}
