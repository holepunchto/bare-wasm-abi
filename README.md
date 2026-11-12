# bare-wasm-abi

The <https://github.com/holepunchto/libjs> ABI for WebAssembly addons. Runs Bare addons compiled to `wasm32-wasip1` by implementing the `libjs` functions they import in JavaScript. An addon can reach no further than JavaScript in its realm and the WASI capabilities it is given through [`bare-wasi`](https://github.com/holepunchto/bare-wasi).

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

The `realm` option places the addon in a realm made with [`bare-realm`](https://github.com/holepunchto/bare-realm). The addon is handed the global of that realm, every value the addon creates belongs to it, and scripts and functions the addon compiles run in it. The addon is refused any object or function from another realm, including arguments, return values, and thrown values, so only primitives and values made in the realm can reach it. In the other direction, everything the addon hands out is copied for the caller:

- The exports are a copy, taken when the addon is registered.
- Arrays, plain objects, buffers, typed arrays, data views, dates, errors, and promises are copied in both directions, and any other object becomes a plain object of its own enumerable properties.
- Functions are wrapped in both directions. A wrapper copies its arguments and its result, and cannot be called with `new`.

The addon can run JavaScript in its realm, so never store an object from another realm anywhere the realm can reach, such as on its global or on an object it created, and never touch an object of the realm yourself, such as one returned by `realm.evaluate()`.

```js
const Realm = require('bare-realm')

const exports = instantiate(bytes, { realm: new Realm() })
```

Without a realm, the addon shares the realm of the caller. Scripts then run through indirect `eval`, so top-level `let` and `const` declarations do not carry over from one script to the next.

## Security

A memory bug in an addon stays in the addon's linear memory, whatever realm the addon runs in. Beyond that, the realm decides how far an addon reaches:

- In a shared realm, an addon reaches everything JavaScript in that realm can, so it suits only addons you trust, run on input you do not.
- In a realm of its own, an addon reaches nothing outside that realm and its WASI capabilities, as long as you keep objects from other realms out of the realm. That makes it fit for addons you do not trust, if you can accept that such an addon can still stall or stop the process.

What the ABI does and does not promise in each setup is written down in [`docs/threat-model.md`](docs/threat-model.md), which embedders should read before loading addons.

## Building addons

An addon is a WASI reactor that exports `bare_register_module_v0`, `malloc`, `free`, its memory, and its function table. Undefined functions become imports, and `instantiate()` rejects any import outside the ABI. `cmake-bare` builds addons this way for the `wasi-wasm32` target of `cmake-toolchains`.

## Avoiding traps

A trap poisons the addon for good, so an addon should handle its errors instead of trapping on them:

- Throw JavaScript errors instead of calling `abort()` or `assert()`.
- Check that `malloc()` did not return `NULL`.
- Guard against division by zero.
- Build with `-mnontrapping-fptoint` so float to integer conversions do not trap.
- Call functions through pointers of their exact signature.
- Bound recursion and keep large buffers off the stack.

Most memory bugs do not trap at all, so also test the addon natively with sanitizers enabled.

## Generating the bindings

`lib/abi.js` and `lib/constants.js` are generated from `js.h`. They hold the marshalling for each libjs function and the enums and wasm32 struct layouts. The semantics of each function are written by hand in `lib/js.js`, along with the functions excluded by design.

```
npm run generate
```

The `libjs` release is pinned in `CMakeLists.txt` and must match the one Bare builds against.

## License

Apache-2.0
