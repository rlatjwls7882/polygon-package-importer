import assert from 'node:assert/strict';

class XmlNode {
  constructor(data) {
    this.localName = data.tag;
    this.attrs = data.attributes;
    this.children = data.children.map(child => new XmlNode(child));
    this.textContent = data.text + this.children.map(child => child.textContent).join('');
  }
  getAttribute(key) { return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null; }
  hasAttribute(key) { return Object.hasOwn(this.attrs, key); }
}

// Python parses the fixture XML; Node tests use the same DOM-shaped descriptor.
export function installDOMParser(tree) {
  globalThis.DOMParser = class {
    parseFromString(xml, type) {
      assert(xml.includes('<problem'), 'Invalid fixture XML');
      assert.equal(type, 'application/xml');
      return {querySelector:() => null, documentElement:new XmlNode(typeof tree === 'function' ? tree() : tree)};
    }
  };
}
