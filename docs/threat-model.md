# Threat model

## What this is

`bare-wasm-abi` runs Bare addons compiled to WebAssembly by implementing `libjs` in JavaScript. It is meant for addons you trust, run on input you do not. It is not meant for addons you do not trust.

What follows says what the ABI promises, what it does not promise, and which of the two your bug report falls under. It builds on the [threat model of Bare](https://github.com/holepunchto/bare/blob/main/docs/threat-model.md), so read that first.

## What counts

- **Counts:** `index.js` and `lib/`, including the bindings generated into `lib/abi.js` and `lib/constants.js`.
- **Does not count:** `scripts/`, `test/`, addon code, and the modules the ABI builds on. [`bare-wasm`](https://github.com/holepunchto/bare-wasm) is the engine's WebAssembly API, and [`bare-wasi`](https://github.com/holepunchto/bare-wasi) makes its own promises about WASI.

## What an addon gets

An addon gets two things, and nothing else.

**The realm.** The ABI is `libjs`, and `libjs` is the whole of JavaScript. `js_get_global()` hands out `globalThis`, and every object leads back to the intrinsics anyway, so an addon that has no global can still reach `Function` through `({}).constructor.constructor` and run any JavaScript it likes. The functions that compile code are left out because compiling belongs to the embedder, not because leaving them out is a wall.

**The WASI capabilities it is given.** `instantiate()` passes its `wasi` options on to `bare-wasi`, and an addon given none gets none.

`instantiate()` turns down an addon that imports anything else, so these two are the whole list. But the first one is large. An addon can do whatever JavaScript in the same realm can do, and that includes everything in the `Bare` namespace.

## What WebAssembly buys you

A native addon with a memory bug corrupts the process. A WebAssembly addon with the same bug corrupts its own linear memory and nothing else. That is the reason to compile an addon to WebAssembly, and it is the promise this ABI exists to keep.

It does not mean the bug is harmless. An attacker who feeds the addon input can still corrupt everything in its linear memory, including its heap, its shadow stack, and the function pointers it keeps there. WebAssembly makes the next step harder, as return addresses never live in linear memory and indirect calls are checked against their type, but it does not make it impossible. An attacker who gets that far holds every import the addon has, and so holds the realm.

So the promise is about where a memory bug can land, not about what a compromised addon can do.

## The promise

An addon reaches no native code and no memory outside its own linear memory through anything the ABI offers. Said another way, the ABI adds no power that JavaScript in the same realm does not already have.

In detail:

- The ABI never hands JavaScript a view of linear memory, and never hands an addon a view of JavaScript memory. Buffers are copied in and copied back, bounded by the length of the JavaScript buffer.
- Every pointer and length an addon passes is read through the bounds checks of the engine. One that is out of range raises an exception in the addon rather than reading or writing anything else.
- Handles, references, callback info, wraps, type tags, and externals belong to the addon that made them. One addon cannot name or unwrap those of another.
- A trap poisons only the instance it happened in. Later calls into it throw, and its finalizers and teardown callbacks no longer run.

## What is a wall and what is not

A **No** row cannot be the basis of a bug report.

| Thing                              | Is it a wall? | Why                                                                           |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| Linear memory <-> the process      | Yes           | The engine bounds every access, and the ABI copies rather than shares         |
| Addon <-> addon, native state      | Yes           | Each instance has its own memory, handles, references, wraps, and externals   |
| Addon <-> addon, through the realm | No            | Both share the realm, so each can call whatever the other hands to JavaScript |
| Addon <-> the realm                | No            | The ABI is `libjs`, and `libjs` hands out the realm                           |
| Addon <-> WASI                     | Yes           | `bare-wasi` grants only what it is given, and its promises are its own        |
| Excluded functions                 | No            | Compiling code is left to the embedder, and `Function` is reachable anyway    |
| Trap <-> other instances           | Yes           | A trap poisons its own instance and nothing else                              |
| Addon <-> CPU and memory           | No            | Addons run on the JavaScript thread and their memory can grow to 4 GiB        |

## What we trust

- The JavaScript engine, and its WebAssembly implementation through `bare-wasm`
- `bare-wasi`, for the WASI capabilities
- The addon, as built from its source
- The embedder, including the `wasi` options it passes

## Who we are defending against

The attacker we care about controls the input an addon processes, and can turn a memory bug in the addon into any write to its linear memory.

We are **not** defending against:

- A bad addon. Addons are trusted, and picking them is the embedder's job.
- An attacker who has taken control of an addon. They hold the realm, and the ABI cannot take it back.
- Anything Bare itself does not defend against.

## What embedders must do

**1. Treat addons as trusted code.** An addon can do whatever JavaScript in your realm can do. Do not load one you would not load as a JavaScript module.

**2. Seal before you load anything else.** In an unsealed process, `Bare.Addon` is in reach of every addon, so a compromised WebAssembly addon can load native code and the gain from WebAssembly is gone. Seal with `Bare.Addon.seal()` first, and see the threat model of Bare for what that does and does not cover.

**3. Grant the fewest WASI capabilities you can.** Most addons that only process input need none at all.

**4. Budget CPU and memory yourself.** Nothing here stops an addon from running forever or growing its memory to the limit. If the input can be hostile, run the addon where you can stop it, such as in a thread or a process of its own.

**5. Do not use this ABI for untrusted addons.** Leaving out more functions will not make it safe, as long as an addon receives a single object. Running untrusted addons needs a realm of their own, frozen intrinsics, or a membrane around every value that crosses, and this ABI provides none of these.

## What to report

**Please report:**

- Any way for an addon to read or write memory outside its own linear memory
- Any way for an addon to reach native code, or a power JavaScript in the same realm does not have
- Any way for one addon to reach the native state of another
- A trap that fails to poison its instance, or that reaches beyond it
- An import `instantiate()` lets through that is not in the ABI or WASI

**Not a bug:**

- Anything an addon does through the realm
- Anything that needs a bad or already compromised addon
- Anything crossing a **No** row
- Running forever, using lots of memory, or side channels
- Harm from WASI capabilities the embedder chose to grant

## Common pitfalls

These are the shapes a bug in the ABI is likely to take. Anyone changing `lib/` should read them.

**Trusting a pointer or a length.** Every one comes from linear memory the attacker may control. Read and write through the views of the runtime so the engine checks the bounds, and never build a view of linear memory longer than the access needs.

**Holding a view across a call.** Linear memory can grow during any call into the addon, and growing it detaches the old buffer. Ask the runtime for its views again after the call rather than keeping your own.

**Handing out linear memory.** A view of linear memory that reaches JavaScript lets JavaScript and the addon share memory, which turns every bug on one side into a bug on the other. Copy in and copy back, and write back no more than the JavaScript buffer holds.

**Scanning without an end.** A string the addon says is terminated may not be. Stop at the end of linear memory.

**Reading through patched intrinsics.** JavaScript in the realm can patch prototypes, so a getter called on a value from the addon may not be the one you meant. Use the intrinsics captured when the module loads.

**Sharing state between instances.** Each instance has its own runtime. Anything keyed by a number the addon chose, such as a handle or a reference, must be looked up in that runtime and nowhere else.

**Turning a trap into a crash.** A trap must poison its instance and surface as an error. Anything that lets it abort the process, or lets a poisoned instance run again, breaks the promise.
