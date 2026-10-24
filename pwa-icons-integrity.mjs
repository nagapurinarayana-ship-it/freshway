import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const channelsByColorType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const crcTable = makeCrcTable();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function assertValidPng(input, { width, height, label = 'PNG' }) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert.ok(bytes.length > 64, label + ' must not be empty.');
  assert.ok(bytes.subarray(0, 8).equals(signature), label + ' has an invalid PNG signature.');

  let offset = 8;
  let header = null;
  let ended = false;
  const imageData = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, label + ' has a truncated PNG chunk header.');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    assert.ok(end <= bytes.length, label + ' has a truncated ' + bytes.toString('ascii', offset + 4, offset + 8) + ' chunk.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const actualCrc = crc32(bytes.subarray(offset + 4, dataEnd));
    const expectedCrc = bytes.readUInt32BE(dataEnd);
    assert.equal(actualCrc, expectedCrc, label + ' has an invalid ' + type + ' checksum.');

    if (type === 'IHDR') {
      assert.equal(offset, 8, label + ' must begin with IHDR.');
      assert.equal(length, 13, label + ' has an invalid IHDR.');
      header = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        interlace: bytes[dataStart + 12]
      };
    } else if (type === 'IDAT') {
      imageData.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      assert.equal(length, 0, label + ' has an invalid IEND.');
      ended = true;
      offset = end;
      break;
    }
    offset = end;
  }

  assert.ok(header, label + ' is missing IHDR.');
  assert.ok(ended && offset === bytes.length, label + ' is truncated or contains trailing bytes.');
  assert.equal(header.width, width, label + ' must be ' + width + 'px wide.');
  assert.equal(header.height, height, label + ' must be ' + height + 'px high.');
  assert.ok(imageData.length > 0, label + ' is missing image data.');
  assert.ok([1,2,4,8,16].includes(header.bitDepth), label + ' has an unsupported bit depth.');
  const channels = channelsByColorType[header.colorType];
  assert.ok(channels, label + ' has an unsupported PNG color type.');

  const decoded = inflateSync(Buffer.concat(imageData));
  assert.ok(decoded.length > 0, label + ' has empty decoded pixel data.');
  if (header.interlace === 0) {
    const expectedDecodedLength = header.height * (Math.ceil(header.width * channels * header.bitDepth / 8) + 1);
    assert.equal(decoded.length, expectedDecodedLength, label + ' has incomplete decoded image rows.');
  }
  return { width: header.width, height: header.height, bytes: bytes.length };
}

const root = fileURLToPath(new URL('.', import.meta.url));
for (const [path, size] of [
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
  ['icons/icon-192-maskable.png', 192],
  ['icons/icon-512-maskable.png', 512]
]) {
  assertValidPng(readFileSync(resolve(root, path)), { width: size, height: size, label: path });
}
const masterLogoBase64 = readFileSync(resolve(root, 'freshway-logo-master.webp')).toString('base64');
const faviconSvg = readFileSync(resolve(root, 'icon.svg'), 'utf8');
assert.ok(faviconSvg.includes('data:image/webp;base64,'), 'browser favicon must embed the FreshWay master logo');
assert.equal(faviconSvg.split('href="data:image/webp;base64,')[1]?.split('"')[0], masterLogoBase64, 'browser favicon must embed the exact FreshWay master logo');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.icons.length, 2, 'PWA manifest must not advertise the legacy P-monogram icons');
for (const [size, path] of [['192x192', 'icons/icon-192.svg'], ['512x512', 'icons/icon-512.svg']]) {
  const icon = manifest.icons.find(item => item.sizes === size && item.type === 'image/svg+xml');
  assert.ok(icon, 'PWA manifest must provide a FreshWay SVG icon at ' + size);
  assert.equal(icon.src, '/' + path + '?v=20261024-master-logo-v1');
  const svg = readFileSync(resolve(root, path), 'utf8');
  assert.ok(svg.startsWith('<svg '), path + ' must be an SVG document');
  assert.ok(svg.includes('viewBox="0 0 512 512"'), path + ' must be a square scalable SVG');
  const embeddedLogo = svg.split('href="data:image/webp;base64,')[1]?.split('"')[0];
  assert.equal(embeddedLogo, masterLogoBase64, path + ' must embed the exact FreshWay master logo');
}
console.log('FreshWay PWA icon integrity passed: legacy PNGs are valid and the install manifest uses the exact FreshWay master logo.');
