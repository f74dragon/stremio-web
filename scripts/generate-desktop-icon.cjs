// Dependency-free rasterization of desktop/assets/icon.svg's simple geometry.
// Checked-in PNG/ICO assets make normal builds independent of image tools.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const directory = path.resolve(__dirname, '../desktop/assets');
const crc32 = (data) => {
    let value = 0xffffffff;
    for (const byte of data) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const name = Buffer.from(type);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([header, name, data, crc]);
};
const render = (size) => {
    const pixels = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const sum = [0, 0, 0];
        let coverage = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
            const px = (x + (sx + 0.5) / 4) * 256 / size;
            const py = (y + (sy + 0.5) / 4) * 256 / size;
            const dx = Math.max(74 - px, 0, px - 182);
            const dy = Math.max(74 - py, 0, py - 182);
            if (dx * dx + dy * dy > 58 * 58) continue;
            const triangle = px >= 104 && px <= 178 && Math.abs(py - 128) <= (178 - px) * 50 / 74;
            const t = Math.max(0, Math.min(1, (py - 16) / 224));
            const rgb = triangle ? [250, 248, 255] : [133 - 48 * t, 106 - 42 * t, 242 - 58 * t];
            rgb.forEach((value, channel) => { sum[channel] += value; });
            coverage++;
        }
        const offset = y * (size * 4 + 1) + 1 + x * 4;
        sum.forEach((value, channel) => { pixels[offset + channel] = coverage ? Math.round(value / coverage) : 0; });
        pixels[offset + 3] = Math.round(coverage * 255 / 16);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
};
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const entries = Buffer.alloc(6 + 16 * sizes.length);
entries.writeUInt16LE(1, 2);
entries.writeUInt16LE(sizes.length, 4);
let offset = entries.length;
images.forEach((png, index) => {
    const entry = 6 + index * 16;
    entries[entry] = entries[entry + 1] = sizes[index] % 256;
    entries.writeUInt16LE(1, entry + 4);
    entries.writeUInt16LE(32, entry + 6);
    entries.writeUInt32LE(png.length, entry + 8);
    entries.writeUInt32LE(offset, entry + 12);
    offset += png.length;
});
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'icon.png'), images[images.length - 1]);
fs.writeFileSync(path.join(directory, 'icon.ico'), Buffer.concat([entries, ...images]));
