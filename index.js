const WASI = require('bare-wasi')
const Runtime = require('./lib/runtime')
const bindings = require('./lib/abi')
const js = require('./lib/js')

const required = [
  'memory',
  '__indirect_function_table',
  'malloc',
  'free',
  'bare_register_module_v0'
]

module.exports = function instantiate(bytes, opts = {}) {
  const module = new WebAssembly.Module(bytes)

  for (const name of required) {
    if (!WebAssembly.Module.exports(module).some((entry) => entry.name === name)) {
      throw new Error(`WebAssembly addon does not export '${name}'`)
    }
  }

  const rt = new Runtime()
  const wasi = new WASI(opts.wasi || { version: 'preview1' })

  const env = {}

  for (const [name, fn] of Object.entries(bindings(rt, js))) {
    if (typeof js[name.slice(3)] === 'function') env[name] = fn
  }

  const unsupported = []

  for (const entry of WebAssembly.Module.imports(module)) {
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

  const instance = new WebAssembly.Instance(module, { env, ...wasi.getImportObject() })

  rt.attach(instance)
  wasi.initialize(instance)

  const target = {}
  const depth = rt.openScope()

  let result

  try {
    const handle = instance.exports.bare_register_module_v0(rt.ENV, rt.handle(target)) >>> 0

    result = handle === 0 ? target : rt.value(handle)
  } catch (err) {
    if (err instanceof WebAssembly.RuntimeError) rt.crashed = err
    throw err
  } finally {
    rt.closeScope(depth)
  }

  if (rt.exception !== null) {
    const { value } = rt.exception
    rt.exception = null
    throw value
  }

  return result
}
