# Threat model

## What this is

`bare-wasm-abi` runs Bare addons compiled to WebAssembly by implementing `libjs` in JavaScript. An addon runs in one of two setups:

- **A shared realm.** By default, the addon shares the realm of the code that loads it. This is for addons you trust, run on input you do not.
- **A realm of its own.** With the `realm` option, the addon runs in a realm made with [`bare-realm`](https://github.com/holepunchto/bare-realm), and the ABI keeps everything outside that realm out of its reach, and the objects of that realm out of the reach of everything outside it. This is for addons you do not trust, as long as you can accept that such an addon can still stall or stop the process.

What follows says what the ABI promises in each setup, what it does not promise, and which of the two your bug report falls under. It builds on the [threat model of Bare](https://github.com/holepunchto/bare/blob/main/docs/threat-model.md), so read that first.

## What counts

- **Counts:** `index.js` and `lib/`, including the bindings generated into `lib/abi.js` and `lib/constants.js`.
- **Does not count:** `scripts/`, `test/`, addon code, and the modules the ABI builds on. [`bare-wasm`](https://github.com/holepunchto/bare-wasm), [`bare-wasi`](https://github.com/holepunchto/bare-wasi), [`bare-realm`](https://github.com/holepunchto/bare-realm), and [`bare-type`](https://github.com/holepunchto/bare-type) make their own promises.

## What an addon gets

An addon gets two things, and nothing else.

**A realm.** The ABI is `libjs`, and `libjs` is the whole of JavaScript. `js_get_global()` hands out the global of the realm, and every object leads back to its intrinsics anyway, so an addon can always reach `Function` and run any JavaScript it likes in its realm. Compiling scripts and functions through the ABI adds nothing to that.

- In a shared realm, that is the realm of the caller, with everything in it, including the `Bare` namespace.
- In a realm of its own, that is a fresh realm with only the standard built-ins. It has no `Bare` namespace and no `require()`, and `import()` always fails.

**The WASI capabilities it is given.** `instantiate()` passes its `wasi` options on to `bare-wasi`, and an addon given none gets none.

`instantiate()` turns down an addon that imports anything else, so these two are the whole list.

## What WebAssembly buys you

A native addon with a memory bug corrupts the process. A WebAssembly addon with the same bug corrupts its own linear memory and nothing else. That is the reason to compile an addon to WebAssembly, and it is the first promise this ABI exists to keep.

It does not mean the bug is harmless. An attacker who feeds the addon input can still corrupt everything in its linear memory, including its heap, its shadow stack, and the function pointers it keeps there. WebAssembly makes the next step harder, as return addresses never live in linear memory and indirect calls are checked against their type, but it does not make it impossible. An attacker who gets that far holds every import the addon has, and so holds its realm.

In a shared realm, that is the realm of the caller and everything it can do. In a realm of its own, that is a realm with nothing in it but the standard built-ins.

## The promises

### Every addon

An addon reaches no native code and no memory outside its own linear memory through anything the ABI offers. Said another way, the ABI adds no power that JavaScript in the realm of the addon does not already have.

In detail:

- The ABI never hands JavaScript a view of linear memory, and never hands an addon a view of JavaScript memory. Buffers are copied in and copied back, bounded by the size of the copy even if the JavaScript buffer is resized in between.
- Every pointer and length an addon passes is read through the bounds checks of the engine. One that is out of range raises an exception in the addon rather than reading or writing anything else.
- Handles, references, callback info, wraps, type tags, externals, and prepared scripts belong to the addon that made them. One addon cannot name or unwrap those of another.
- A trap poisons only the instance it happened in. The frames still running in it unwind, later calls into it throw, and its finalizers and teardown callbacks no longer run.

### An addon in a realm of its own

An addon in a realm of its own reaches nothing outside that realm and its WASI capabilities through anything the ABI offers, as long as the embedder keeps objects from other realms out of it and never reaches into it.

In detail:

- Every value the ABI creates for the addon, including its functions, its errors, and its exports, is made with the constructors of the realm, captured before the addon runs.
- Every object and function the addon is handed is checked with `Realm.isFrom()` to come from its realm. That covers arguments, receivers, `new.target`, return values, property reads, references, and caught exceptions. One from another realm is refused with a `TypeError`, and so is one whose realm the engine cannot tell.
- A class of the addon constructed with a `new.target` from another realm, such as by a subclass outside the realm, is refused before the addon runs. The receiver of such a call would come from the realm but take its prototype from outside it, which the check alone would not see.
- Every operation the ABI performs on a value of the addon runs on the intrinsics of its realm. Code the operation ends up calling in the realm, such as a getter, a `toString()` method, or a proxy trap, is only ever handed values from the realm.
- A thrown value from another realm is replaced with an `Error` from the realm, both before the addon can catch it and before it leaves a function of the addon for its caller. That covers errors the ABI and the engine raise inside the code of the ABI, traps, and errors from WASI. An error from the host keeps its type and message.
- Scripts and functions the addon compiles run in its realm and nowhere else.
- Everything the addon hands to the host crosses as a copy, read with the operations of the realm. That covers the exports `instantiate()` returns, the results and errors of the functions of the addon, and the errors it passes to `js_fatal_exception()`. Arrays, plain objects, buffers, typed arrays, data views, dates, errors, and promises are copied, and any other object arrives as a plain object of its own enumerable properties. Functions cross in both directions as wrappers that copy their arguments and results, and cannot be constructed. Code of the realm that runs while a copy is made is only ever handed values from the realm.

### What the check cannot see

The check looks at values as they cross into the addon. It cannot see these, and each of them only matters once an object from another realm is already inside:

- **Objects stored in the realm.** The addon can run JavaScript in its realm, and that JavaScript reads properties directly, without going through the ABI. An object from another realm stored on the global of the realm, or on an object the realm made, is in reach of the addon.
- **Wrappers made in the realm.** A proxy reports the realm it was made in, not the realm of the object it wraps, so JavaScript in the realm can wrap an object from another realm and hand the wrapper to the addon.

- **Objects of the realm held outside it.** Code outside the realm that touches an object of the realm directly, by reading a property, converting it, or logging it, hands the code of the realm arguments made outside it. The ABI never hands out such an object, so this only matters when the embedder reaches into the realm itself, such as through `realm.evaluate()`.
- **Errors raised by the realm on its own.** Code in the realm can throw from a job or leave a promise rejected without going through the ABI, and the process reports those itself. Bare hands its listeners a placeholder in place of anything from another realm, so that the original never reaches code outside the realm.

So the promise holds only while the embedder never puts an object from another realm into the realm of the addon, and never touches an object of the realm itself. See [What embedders must do](#what-embedders-must-do).

## What is a wall and what is not

A **No** row cannot be the basis of a bug report.

| Thing                                    | Is it a wall? | Why                                                                                        |
| ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ |
| Linear memory <-> the process            | Yes           | The engine bounds every access, and the ABI copies rather than shares                      |
| Addon <-> addon, native state            | Yes           | Each instance has its own memory, handles, references, wraps, externals, and scripts       |
| Addon <-> addon, in the same realm       | No            | Both share the realm, so each can call whatever the other hands to JavaScript              |
| Addon in a shared realm <-> that realm   | No            | The ABI is `libjs`, and `libjs` hands out the realm                                        |
| Addon in a realm of its own <-> the rest | Yes           | What it is handed is checked and what it hands out is copied, while the embedder keeps out |
| Addon <-> WASI                           | Yes           | `bare-wasi` grants only what it is given, and its promises are its own                     |
| Excluded functions                       | No            | They are left out because JavaScript cannot provide them, not to keep anything out         |
| Trap <-> other instances                 | Yes           | A trap poisons its own instance and nothing else                                           |
| Addon <-> CPU and memory                 | No            | Addons run on the JavaScript thread, and the engine heap is shared with the process        |
| Addon <-> the life of the process        | No            | `js_fatal_exception()` throws outside the addon, which by default ends a Bare process      |

## What we trust

- The JavaScript engine, and its WebAssembly implementation through `bare-wasm`
- `bare-wasi`, for the WASI capabilities
- `bare-realm`, for making realms and telling which realm an object comes from
- `bare-type`, for telling what a value is
- Bare, for keeping uncaught exceptions and unhandled rejections from another realm away from its listeners
- In a shared realm, the addon, as built from its source
- The embedder, including the `wasi` options and the realm it passes

## Who we are defending against

In a shared realm, the attacker we care about controls the input an addon processes, and can turn a memory bug in the addon into any write to its linear memory.

In a realm of its own, the attacker we care about controls the addon itself. We assume they write whatever WebAssembly they like, call every import in any order with any arguments, and run any JavaScript they like in the realm.

We are **not** defending against:

- A bad or compromised addon in a shared realm. It holds the realm, and the ABI cannot take it back.
- An addon that stalls or stops the process, by running forever, by using up memory, or by ending the process.
- Side channels.
- Anything Bare itself does not defend against.

## What embedders must do

**1. Pick the setup for each addon.** An addon you trust can run in either setup. An addon you do not trust must run in a realm of its own, and only if you can accept that it may stall or stop the process. If you cannot, run it in a process of its own instead.

**2. Give each untrusted addon a realm of its own.** Addons that share a realm share everything in it, so one can reach whatever the other hands to JavaScript.

**3. Keep the realm of the addon to itself.** Never store an object from another realm on the global of the realm or on an object the realm made, and never touch an object of the realm from outside it. Work with the copies `instantiate()` hands out, and do not read what `realm.evaluate()` returns unless it is a primitive.

**4. Seal before you load anything else.** In an unsealed process, `Bare.Addon` is in reach of every addon in a shared realm, so a compromised WebAssembly addon can load native code and the gain from WebAssembly is gone. Seal with `Bare.Addon.seal()` first, and see the threat model of Bare for what that does and does not cover.

**5. Grant the fewest WASI capabilities you can.** Most addons that only process input need none at all.

**6. Budget CPU and memory yourself.** Nothing here stops an addon from running forever, growing its memory to the limit, or ending the process. If that matters, run the addon where you can stop it, such as in a thread or a process of its own.

## What to report

**Please report:**

- Any way for an addon to read or write memory outside its own linear memory
- Any way for an addon to reach native code, or a power JavaScript in its realm does not have
- Any way for one addon to reach the native state of another
- Any way for an addon in a realm of its own to get hold of an object from another realm, or to run code outside its realm, without the embedder putting an object from another realm into its realm or touching an object of its realm
- Any way for the ABI to hand code outside the realm an object of the realm
- A trap that fails to poison its instance, or that reaches beyond it
- An import `instantiate()` lets through that is not in the ABI or WASI

**Not a bug:**

- Anything an addon in a shared realm does through the realm
- Anything that needs a bad or compromised addon in a shared realm
- Anything that needs the embedder to put an object from another realm into the realm of the addon
- Anything crossing a **No** row
- Running forever, using lots of memory, ending the process, or side channels
- Harm from WASI capabilities the embedder chose to grant

## Common pitfalls

These are the shapes a bug in the ABI is likely to take. Anyone changing `lib/` should read them.

**Trusting a pointer or a length.** Every one comes from linear memory the attacker may control. Read and write through the views of the runtime so the engine checks the bounds, and never build a view of linear memory longer than the access needs.

**Holding a view across a call.** Linear memory can grow during any call into the addon, and growing it detaches the old buffer. Ask the runtime for its views again after the call rather than keeping your own.

**Handing out linear memory.** A view of linear memory that reaches JavaScript lets JavaScript and the addon share memory, which turns every bug on one side into a bug on the other. Copy in and copy back, and write back no more than the JavaScript buffer holds.

**Scanning without an end.** A string the addon says is terminated may not be. Stop at the end of linear memory.

**Creating values with the wrong constructors.** An object, array, error, or function written in `lib/` belongs to the realm of the ABI, not to the realm of the addon, and handing it to an addon in a realm of its own hands out a way back to the host. Create values with the constructors in `rt.realm`, and remember that a function defined in `lib/` is a host function.

**Going around the handle check.** Every value must reach the addon through `rt.handle()`, which is where the realm check runs. Writing to the handle table directly, or passing a value to the addon any other way, skips it.

**Handing out values of the realm.** Every value of an addon in a realm of its own that leaves the ABI for code outside the realm must go through `rt.boundary.toHost()`. Returning one as it is, or throwing it, hands its getters and proxy traps to host code.

**Touching values of the addon from host code.** Reading a property, converting a value, or checking `instanceof` can call a getter, a `toString()` method, or a proxy trap in the realm, and code in `lib/` that does so hands it argument lists and descriptors made in the host realm. Go through the intrinsics and helpers in `rt.realm` for every operation on a value of the addon, which also keeps the buffers the addon has staged in sync with the code it runs, and check types with `bare-type` or a brand check rather than `instanceof`.

**Reading through patched intrinsics.** JavaScript in either realm can patch prototypes, so a getter called on a value from the addon may not be the one you meant. Use the intrinsics captured when the module loads, and the constructors captured in `rt.realm` when the runtime is made.

**Sharing state between instances.** Each instance has its own runtime. Anything keyed by a number the addon chose, such as a handle, a reference, or a script, must be looked up in that runtime and nowhere else.

**Turning a trap into a crash.** A trap must poison its instance and surface as an error. Anything that lets it abort the process, or lets a poisoned instance run again, breaks the promise.
