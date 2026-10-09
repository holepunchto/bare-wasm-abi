# bare-wasm-abi

The <https://github.com/holepunchto/libjs> ABI for WebAssembly addons. Runs Bare addons compiled to `wasm32-wasip1` by implementing the `libjs` functions they import in JavaScript. An addon can reach no further than JavaScript in the same realm and the WASI capabilities it is given through [`bare-wasi`](https://github.com/holepunchto/bare-wasi).

```
npm i bare-wasm-abi
```

## Usage

```js
const instantiate = require('bare-wasm-abi')

const exports = instantiate(bytes, {
  wasi: { version: 'preview1', stdout: (data) => console.log(data.toString()) }
})
```

`instantiate()` checks that the module is an addon and that it imports nothing outside the ABI, then registers it and returns its exports. The `wasi` options are passed on to `bare-wasi`, and an addon given none gets no capabilities. A trap inside the addon poisons only its own instance, and later calls into it throw.

## Building addons

An addon is a WASI reactor that exports `bare_register_module_v0`, `malloc`, `free`, its memory, and its function table. Undefined functions become imports, and `instantiate()` rejects any import outside the ABI. `cmake-bare` builds addons this way for the `wasi-wasm32` target of `cmake-toolchains`.

## Generating the bindings

`lib/abi.js` and `lib/constants.js` are generated from `js.h`. They hold the marshalling for each libjs function and the enums and wasm32 struct layouts. The semantics of each function are written by hand in `lib/js.js`, along with the functions excluded by design.

```
npm run generate
```

The `libjs` release is pinned in `CMakeLists.txt` and must match the one Bare builds against.

## License

Apache-2.0
