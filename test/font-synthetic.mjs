// Original test-only SFNT: a single triangle glyph, not derived from any font.
export function syntheticFont(code = 0x5753) {
  const head=Buffer.alloc(54);head.writeUInt32BE(0x00010000,0);head.writeUInt32BE(0x5f0f3cf5,12);head.writeUInt16BE(1000,18);head.writeInt16BE(1,50);
  const maxp=Buffer.alloc(6);maxp.writeUInt32BE(0x00010000);maxp.writeUInt16BE(2,4);
  const hhea=Buffer.alloc(36);hhea.writeUInt32BE(0x00010000);hhea.writeUInt16BE(2,34);
  const hmtx=Buffer.alloc(8);hmtx.writeUInt16BE(1000,0);hmtx.writeUInt16BE(1000,4);
  const glyf=Buffer.alloc(32);glyf.writeInt16BE(1,0);glyf.writeInt16BE(100,6);glyf.writeInt16BE(100,8);glyf.writeUInt16BE(2,10);
  glyf.set([1,1,1],14);glyf.writeInt16BE(0,17);glyf.writeInt16BE(100,19);glyf.writeInt16BE(-100,21);glyf.writeInt16BE(0,23);glyf.writeInt16BE(0,25);glyf.writeInt16BE(100,27);
  const loca=Buffer.alloc(12);loca.writeUInt32BE(glyf.length,8);
  const cmap=Buffer.alloc(44);cmap.writeUInt16BE(1,2);cmap.writeUInt16BE(3,4);cmap.writeUInt16BE(1,6);cmap.writeUInt32BE(12,8);
  cmap.writeUInt16BE(4,12);cmap.writeUInt16BE(32,14);cmap.writeUInt16BE(4,18);cmap.writeUInt16BE(4,20);cmap.writeUInt16BE(1,22);
  cmap.writeUInt16BE(code,26);cmap.writeUInt16BE(0xffff,28);cmap.writeUInt16BE(code,32);cmap.writeUInt16BE(0xffff,34);cmap.writeUInt16BE((1-code)&0xffff,36);cmap.writeUInt16BE(1,38);
  const tables={cmap,glyf,head,hhea,hmtx,loca,maxp};const names=Object.keys(tables).sort();
  let offset=12+names.length*16;const chunks=[];const directory=Buffer.alloc(offset);directory.writeUInt32BE(0x00010000);directory.writeUInt16BE(names.length,4);directory.writeUInt16BE(64,6);directory.writeUInt16BE(2,8);directory.writeUInt16BE(48,10);
  names.forEach((name,index)=>{const table=tables[name],entry=12+index*16;directory.write(name,entry,'ascii');directory.writeUInt32BE(offset,entry+8);directory.writeUInt32BE(table.length,entry+12);const padded=Buffer.alloc((table.length+3)&~3);table.copy(padded);chunks.push(padded);offset+=padded.length;});
  return Buffer.concat([directory,...chunks]);
}
