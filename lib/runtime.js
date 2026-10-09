const type = require('bare-type')
const { enums, layouts } = require('./constants')

const ENV = 1

class Handle {
  constructor(id) {
    this.id = id
  }
}
const NUL_TERMINATED = 0xffffffff

module.exports = class Runtime {
  constructor() {
    this.ENV = ENV
    this.NUL_TERMINATED = NUL_TERMINATED

    this.enums = enums
    this.layouts = layouts
    this.type = type

    this.exports = null
    this.memory = null
    this.table = null
    this.crashed = null

    this.handles = [undefined]
    this.scopes = []
    this.exception = null

    this.references = new Map()
    this.infos = new Map()
    this.views = new Map()
    this.deferreds = new Map()
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
      value: (ptr, value) =>
        view().setUint32(ptr, value instanceof Handle ? value.id : this.handle(value), true),
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

    try {
      fn()
      return 0
    } catch (err) {
      this.exception = { value: err }
      return enums.js_pending_exception
    }
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

        if (end === bytes.length) throw new RangeError('String is not NUL terminated')
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
    const ptr = this.exports.malloc(Math.max(len, 1)) >>> 0
    if (ptr === 0) throw new RangeError('WebAssembly addon is out of memory')
    return ptr
  }

  free(ptr) {
    this.exports.free(ptr)
  }

  // Guests can only address their own linear memory, so a pointer into a
  // JavaScript buffer points at a copy that is written back when its handle
  // scope closes.
  stage(target, opts = {}) {
    const { ptr = this.malloc(target.byteLength), copy = true, free = true, finalize = null } = opts

    if (copy) this.bytes.set(target, ptr)

    this.scopes[this.scopes.length - 1].staged.push({ ptr, target, free, finalize })

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

  writeBack(entry) {
    if (entry.target.byteLength === 0) return

    entry.target.set(this.bytes.subarray(entry.ptr, entry.ptr + entry.target.byteLength))
  }

  // Staged buffers are written back before a call into JavaScript and refreshed
  // after it, so each side sees the changes of the other.
  around(fn) {
    for (const scope of this.scopes) for (const entry of scope.staged) this.writeBack(entry)

    try {
      return fn()
    } finally {
      for (const scope of this.scopes) {
        for (const entry of scope.staged) this.bytes.set(entry.target, entry.ptr)
      }
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

    if (this.crashed === null) {
      for (const entry of scope.staged) {
        this.writeBack(entry)

        if (entry.free) this.free(entry.ptr)
        if (entry.finalize) this.finalize(entry.finalize)
      }
    }

    this.handles.length = scope.start
  }

  invoke(cb, info) {
    if (this.crashed !== null) {
      throw new Error('WebAssembly addon has crashed', { cause: this.crashed })
    }

    const fn = this.table.get(cb)
    const id = this.id()
    const depth = this.openScope()

    this.infos.set(id, info)

    let result

    try {
      const handle = fn(ENV, id) >>> 0

      if (handle !== 0) result = this.value(handle)
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) this.crashed = err
      throw err
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
    const rt = this

    const fn = function (...args) {
      return rt.invoke(cb, { receiver: this, args, data, newTarget: new.target })
    }

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

    try {
      this.table.get(cb)(ENV, data, hint)
    } catch (err) {
      if (err instanceof WebAssembly.RuntimeError) this.crashed = err
    } finally {
      this.closeScope(depth)
      this.exception = null
    }
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
