import { deflateRawSync } from 'node:zlib';
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;}
  return (crc^0xffffffff)>>>0;
}
export function makeZip(files, {declaredSize={}}={}) {
  const locals=[],central=[];let offset=0;
  for(const [name,content] of Object.entries(files)) {
    const data=Buffer.from(content),packed=deflateRawSync(data),filename=Buffer.from(name);
    const size=declaredSize[name]??data.length,crc=crc32(data);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
    local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(packed.length,18);
    local.writeUInt32LE(size,22);local.writeUInt16LE(filename.length,26);
    locals.push(local,filename,packed);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);
    entry.writeUInt16LE(8,10);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(packed.length,20);
    entry.writeUInt32LE(size,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    central.push(entry,filename);offset+=local.length+filename.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  const result=Buffer.concat([...locals,directory,end]);
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.length);
}
