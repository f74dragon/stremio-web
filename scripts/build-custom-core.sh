#!/usr/bin/env bash
set -eu
cargo test --locked -p stremio-core --quiet
if [ "${1:-}" = '--tests-only' ]; then exit 0; fi
rustup target add wasm32-unknown-unknown
cargo build --locked -p stremio-core-web --target wasm32-unknown-unknown --release
mkdir -p /repo/.core-build/tools /repo/.core-build/wasm
if [ ! -x /repo/.core-build/tools/wasm-bindgen-0.2.121-x86_64-unknown-linux-musl/wasm-bindgen ]; then
    curl --fail --location --retry 3 https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.121/wasm-bindgen-0.2.121-x86_64-unknown-linux-musl.tar.gz |
        tar xz -C /repo/.core-build/tools
fi
/repo/.core-build/tools/wasm-bindgen-0.2.121-x86_64-unknown-linux-musl/wasm-bindgen \
    --target web --no-typescript --out-dir /repo/.core-build/wasm \
    target/wasm32-unknown-unknown/release/stremio_core_web.wasm
