const type = require('bare-type')
const Realm = require('bare-realm')
const wasm = require('bare-wasm')
const { enums, layouts } = require('./constants')
const createRealm = require('./realm')
const Boundary = require('./boundary')

const ENV = 1

class Handle {
  #id

  constructor(id) {
    this.#id = id
  }

  // Unlike `instanceof`, a brand check runs no code of the value it is given.
  static id(value) {
    return typeof value === 'object' && value !== null && #id in value ? value.#id : null
  }
}
const NUL_TERMINATED = 0xffffffff

module.exports = class Runtime {
  constructor(realm = null) {
    this.ENV = ENV
    this.NUL_TERMINATED = NUL_TERMINATED

    this.enums = enums
    this.layouts = layouts
    this.type = type
    this.realm = sync(this, createRealm(realm))
    this.isolated = this.realm.global !== globalThis
    this.staging = 0
    this.boundary = this.isolated ? new Boundary(this) : null

    this.exports = null
    this.memory = null
    this.table = null
    this.crashed = null
    this.teardowns = null

    this.handles = [undefined]
    this.scopes = []
    this.exception = null

    this.references = new Map()
    this.infos = new Map()
    this.views = new Map()
    this.deferreds = new Map()
    this.scripts = new Map()
    this.nextId = 1

    this.wraps = new WeakMap()
    this.tags = new WeakMap()
    this.externals = new WeakMap()

    this.finalizers = new FinalizationRegistry((finalizer) => this.finalize(finalizer))

    this._bytes = null
    this._view = null

    this.read = {
      utf8: (ptr, len) => this.string(ptr, len, 1, 'utf8'),
      utf16le: (ptr, len) => this.string(ptr, len, 2, 'utf16le'),
      latin1: (ptr, len) => this.string(ptr, len, 1, 'latin1')
    }

    const view = () => this.view

    this.write = {
      value: (ptr, value) => view().setUint32(ptr, Handle.id(value) ?? this.handle(value), true),
      bool: (ptr, value) => view().setUint8(ptr, value ? 1 : 0),
      i32: (ptr, value) => view().setInt32(ptr, value, true),
      u32: (ptr, value) => view().setUint32(ptr, value, true),
      i64: (ptr, value) => view().setBigInt64(ptr, BigInt(value), true),
      u64: (ptr, value) => view().setBigUint64(ptr, BigInt(value), true),
      f64: (ptr, value) => view().setFloat64(ptr, value, true)
    }
  }

  attach(instance) {
    this.exports = instance.exports
    this.memory = instance.exports.memory
    this.table = instance.exports.__indirect_function_table
  }

  get bytes() {
    if (this._bytes === null || this._bytes.buffer !== this.memory.buffer) {
      this._bytes = new Uint8Array(this.memory.buffer)
    }

    return this._bytes
  }

  get view() {
    if (this._view === null || this._view.buffer !== this.memory.buffer) {
      this._view = new DataView(this.memory.buffer)
    }

    return this._view
  }

  call(allowsPendingException, fn) {
    if (this.exception !== null && !allowsPendingException) return enums.js_pending_exception

    let status = 0

    try {
      fn()
    } catch (err) {
      this.exception = { value: this.confine(err) }
      status = enums.js_pending_exception
    }

    // A trap in a nested call poisons the instance, so the frames still on the
    // stack must not run on.
    if (this.crashed !== null) throw this.crashed

    return status
  }

  // Primitives belong to every realm. An addon in the host realm is trusted
  // with the whole process, so it may also hold objects from other realms.
  owns(value) {
    return !this.isolated || !this.isObject(value) || Realm.isFrom(value, this.realm.global)
  }

  isObject(value) {
    return (typeof value === 'object' && value !== null) || typeof value === 'function'
  }

  // A thrown value from another realm must not reach code in the realm of the
  // addon. An error from the host keeps its type and message, which the host
  // wrote.
  confine(value) {
    if (this.owns(value)) return value

    const { errors } = this.realm

    if (!(value instanceof Error)) return new errors.Error('A value from another realm was thrown')

    return new (Object.hasOwn(errors, value.name) ? errors[value.name] : errors.Error)(
      value.message
    )
  }

  // A trap can happen in any call into the addon, including those the runtime
  // makes on its own.
  enter(fn, a, b, c) {
    try {
      return fn(a, b, c)
    } catch (err) {
      if (err instanceof wasm.RuntimeError) this.crashed = err
      throw err
    }
  }

  globalOf(value) {
    return Realm.globalOf(value)
  }

  value(handle) {
    if (handle === 0) return undefined

    if (handle >= this.handles.length) {
      throw new TypeError(`Invalid handle ${handle}`)
    }

    return this.handles[handle]
  }

  values(ptr, count) {
    const result = new Array(count)

    for (let i = 0; i < count; i++) result[i] = this.value(this.view.getUint32(ptr + i * 4, true))

    return result
  }

  handle(value) {
    if (this.scopes.length === 0) throw new Error('No handle scope is open')

    if (!this.owns(value)) throw new TypeError('Value belongs to another realm')

    this.handles.push(value)

    return this.handles.length - 1
  }

  raw(id) {
    return new Handle(id)
  }

  id() {
    return this.nextId++
  }

  ref(id) {
    const reference = this.references.get(id)
    if (reference === undefined) throw new TypeError(`Invalid reference ${id}`)
    return reference
  }

  info(id) {
    const info = this.infos.get(id)
    if (info === undefined) throw new TypeError(`Invalid callback info ${id}`)
    return info
  }

  string(ptr, len, width, encoding) {
    if (ptr === 0) return null

    const bytes = this.bytes

    if (width === 1) {
      let ascii = true
      let end = len === NUL_TERMINATED ? ptr : ptr + len

      if (len === NUL_TERMINATED) {
        while (end < bytes.length && bytes[end] !== 0) ascii = bytes[end++] < 0x80 && ascii

        if (end === bytes.length) {
          throw new RangeError('String is not NUL terminated')
        }
      } else {
        if (end > bytes.length) throw new RangeError('String is out of bounds')

        for (let i = ptr; i < end && ascii; i++) ascii = bytes[i] < 0x80
      }

      if (ascii && end - ptr <= 64) return String.fromCharCode.apply(null, bytes.subarray(ptr, end))

      return Buffer.from(bytes.buffer, ptr, end - ptr).toString(encoding)
    }

    if (len === NUL_TERMINATED) {
      len = 0
      while (this.view.getUint16(ptr + len * 2, true) !== 0) len++
    }

    return Buffer.from(bytes.buffer, ptr, len * 2).toString(encoding)
  }

  malloc(len) {
    const ptr = this.enter(this.exports.malloc, Math.max(len, 1)) >>> 0
    if (ptr === 0) throw new RangeError('WebAssembly addon is out of memory')
    return ptr
  }

  copyIn(bytes) {
    const ptr = this.malloc(bytes.byteLength)

    this.bytes.set(bytes, ptr)

    return ptr
  }

  free(ptr) {
    this.enter(this.exports.free, ptr)
  }

  // Guests can only address their own linear memory, so a pointer into a
  // JavaScript buffer points at a copy that is written back when its handle
  // scope closes.
  stage(target, opts = {}) {
    const { ptr = this.malloc(target.byteLength), copy = true, free = true, finalize = null } = opts

    if (copy) this.bytes.set(target, ptr)

    const length = target.byteLength

    this.scopes[this.scopes.length - 1].staged.push({ ptr, length, target, free, finalize })
    this.staging++

    return ptr
  }

  staged(target) {
    for (const scope of this.scopes) {
      for (const entry of scope.staged) {
        if (
          entry.target.buffer === target.buffer &&
          entry.target.byteOffset === target.byteOffset &&
          entry.target.byteLength === target.byteLength
        ) {
          return entry.ptr
        }
      }
    }

    return 0
  }

  // A resizable buffer can change size while JavaScript runs, but the copy in
  // linear memory keeps the size it was staged with.
  writeBack(entry) {
    const length = Math.min(entry.length, entry.target.byteLength)

    if (length === 0) return

    entry.target.set(this.bytes.subarray(entry.ptr, entry.ptr + length))
  }

  refresh(entry) {
    const length = Math.min(entry.length, entry.target.byteLength)

    this.bytes.set(entry.target.subarray(0, length), entry.ptr)
  }

  // Staged buffers are written back before a call into JavaScript and refreshed
  // after it, so each side sees the changes of the other.
  around(fn, args) {
    if (this.staging === 0) return Reflect.apply(fn, undefined, args)

    for (const scope of this.scopes) for (const entry of scope.staged) this.writeBack(entry)

    try {
      return Reflect.apply(fn, undefined, args)
    } finally {
      for (const scope of this.scopes) for (const entry of scope.staged) this.refresh(entry)
    }
  }

  openScope() {
    this.scopes.push({ start: this.handles.length, staged: [] })

    return this.scopes.length
  }

  closeScope(depth) {
    if (depth !== this.scopes.length) {
      throw new Error('Handle scopes must be closed in reverse order')
    }

    const scope = this.scopes.pop()

    this.handles.length = scope.start
    this.staging -= scope.staged.length

    if (this.crashed !== null) return

    for (const entry of scope.staged) {
      this.writeBack(entry)

      if (entry.free) this.free(entry.ptr)
      if (entry.finalize) this.finalize(entry.finalize)
    }
  }

  invoke(cb, info) {
    try {
      return this.run(cb, info)
    } catch (err) {
      throw this.confine(err)
    }
  }

  run(cb, info) {
    if (this.crashed !== null) {
      throw new Error('WebAssembly addon has crashed', { cause: this.crashed })
    }

    // The receiver of a construct call takes its prototype from `new.target`,
    // which the receiver itself does not reveal to the realm check.
    if (!this.owns(info.newTarget)) {
      throw new TypeError('The new.target belongs to another realm')
    }

    const fn = this.table.get(cb)
    const id = this.id()
    const depth = this.openScope()

    this.infos.set(id, info)

    let result

    try {
      const handle = this.enter(fn, ENV, id) >>> 0

      if (handle !== 0) result = this.value(handle)
    } finally {
      this.infos.delete(id)
      this.closeScope(depth)
    }

    if (this.exception !== null) {
      const { value } = this.exception
      this.exception = null
      throw value
    }

    return result
  }

  function(name, cb, data) {
    const fn = this.realm.function((receiver, args, newTarget) =>
      this.invoke(cb, { receiver, args, data, newTarget })
    )

    Object.defineProperty(fn, 'name', { value: name || '' })

    return fn
  }

  finalizer(target, cb, data, hint) {
    if (cb === 0) return

    this.finalizers.register(target, { cb, data, hint })
  }

  finalize({ cb, data, hint }) {
    if (this.crashed !== null || cb === 0) return

    const depth = this.openScope()

    // A finalizer has no caller to report an error to.
    try {
      try {
        this.enter(this.table.get(cb), ENV, data, hint)
      } finally {
        this.closeScope(depth)
      }
    } catch {}

    this.exception = null
  }

  teardown({ cb, data }) {
    if (this.crashed !== null) return

    // A teardown callback has no caller to report an error to.
    try {
      this.enter(this.table.get(cb), data)
    } catch {}
  }

  struct(name, ptr) {
    const { fields } = layouts[name]
    const view = this.view

    return {
      u32: (field) => view.getUint32(ptr + fields[field], true),
      i32: (field) => view.getInt32(ptr + fields[field], true),
      u64: (field) => view.getBigUint64(ptr + fields[field], true)
    }
  }
}

const synced = [
  'evaluate',
  'Symbol',
  'defineProperty',
  'hasOwn',
  'seal',
  'freeze',
  'get',
  'set',
  'has',
  'instanceOf',
  'toString',
  'toNumber',
  'keys'
]

// Any operation on a value of the addon can run JavaScript in its realm, which
// may read or write the buffers the addon has staged, so the copies in linear
// memory are synced around it.
function sync(rt, realm) {
  const wrap =
    (fn) =>
    (...args) =>
      rt.around(fn, args)

  const reflect = {}

  for (const name of Object.keys(realm.Reflect)) {
    const value = realm.Reflect[name]
    reflect[name] = typeof value === 'function' ? wrap(value) : value
  }

  const result = { ...realm, Reflect: reflect }

  for (const name of synced) result[name] = wrap(realm[name])

  return result
}
