const wasm = require('bare-wasm')
const WASI = require('bare-wasi')
const Runtime = require('./runtime')
const bindings = require('./abi')
const js = require('./js')

const required = [
  'memory',
  '__indirect_function_table',
  'malloc',
  'free',
  'bare_register_module_v0'
]

// Loads and registers an addon, returning its runtime and its exports as they
// are, still in the realm of the addon.
module.exports = function load(bytes, opts = {}) {
  const module = new wasm.Module(bytes)

  for (const name of required) {
    if (!wasm.Module.exports(module).some((entry) => entry.name === name)) {
      throw new Error(`WebAssembly addon does not export '${name}'`)
    }
  }

  const rt = new Runtime(opts.realm)
  const wasi = new WASI(opts.wasi || { version: 'preview1' })

  const env = {}

  for (const [name, fn] of Object.entries(bindings(rt, js))) {
    if (typeof js[name.slice(3)] === 'function') env[name] = fn
  }

  const unsupported = []

  for (const entry of wasm.Module.imports(module)) {
    if (entry.module === 'wasi_snapshot_preview1' && entry.name in wasi.wasiImport) continue
    if (entry.module === 'env' && entry.name in env) continue

    const reason = js.excluded[entry.name.replace(/^js_/, '')]

    unsupported.push(`${entry.module}.${entry.name}${reason ? ` (${reason})` : ''}`)
  }

  if (unsupported.length > 0) {
    throw new Error(
      `WebAssembly addon imports unsupported functions:\n- ${unsupported.join('\n- ')}`
    )
  }

  const instance = new wasm.Instance(module, { env, ...wasi.getImportObject() })

  rt.attach(instance)
  wasi.initialize(instance)

  const target = new rt.realm.Object()
  const depth = rt.openScope()

  let result

  try {
    const handle =
      rt.enter(instance.exports.bare_register_module_v0, rt.ENV, rt.handle(target)) >>> 0

    result = handle === 0 ? target : rt.value(handle)
  } finally {
    rt.closeScope(depth)
  }

  if (rt.exception !== null) {
    const { value } = rt.exception
    rt.exception = null
    throw value
  }

  return { rt, exports: result }
}
