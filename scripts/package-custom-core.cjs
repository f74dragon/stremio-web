const fs = require('fs');
const path = require('path');
const { transformFileSync } = require('@babel/core');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.core-build/package');
const original = path.dirname(require.resolve('@stremio/stremio-core-web/package.json'));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(root, '.core-build/source/LICENSE.md'), path.join(output, 'LICENSE.md'));
for (const name of ['bridge.js', 'worker.js']) {
    fs.copyFileSync(path.join(original, name), path.join(output, name));
}
const { code } = transformFileSync(path.join(root, '.core-build/wasm/stremio_core_web.js'), {
    configFile: false,
    babelrc: false,
    presets: [[require.resolve('@babel/preset-env'), { modules: 'commonjs' }]],
    plugins: [() => ({ visitor: {
        MetaProperty(nodePath) {
            if (nodePath.node.meta.name === 'import' && nodePath.node.property.name === 'meta') {
                nodePath.replaceWithSourceString('({url: self.location.href})');
            }
        }
    } })]
});
fs.writeFileSync(path.join(output, 'stremio_core_web.js'), code);
fs.copyFileSync(path.join(root, '.core-build/wasm/stremio_core_web_bg.wasm'), path.join(output, 'stremio_core_web_bg.wasm'));
const manifest = JSON.parse(fs.readFileSync(path.join(original, 'package.json'), 'utf8'));
manifest.version = '0.58.0-custom.1';
manifest.scripts = {};
manifest.files = ['bridge.js', 'worker.js', 'stremio_core_web.js', 'stremio_core_web_bg.wasm', 'provenance.json', 'LICENSE.md'];
delete manifest.devDependencies;
fs.writeFileSync(path.join(output, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'provenance.json'), `${JSON.stringify({
    upstream: 'https://github.com/Stremio/stremio-core',
    revision: 'c7ba205c881cebc2022b6614b0fd2075789169c0',
    extension: 'ExternalPlaybackProgressChanged',
    patchDirectory: 'core-patches',
    wasmBindgen: '0.2.121',
    rust: '1.95.0'
}, null, 2)}\n`);
