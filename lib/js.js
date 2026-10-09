/* global Float16Array */

// The semantics of each libjs function. The generated bindings decode the
// arguments, and the return value fills the output parameters. Functions with
// output parameters also receive which of them the caller asked for.

const { enums } = require('./constants')

const TypedArray = Object.getPrototypeOf(Uint8Array)

const intrinsics = {
  typedArrayBuffer: getter(TypedArray.prototype, 'buffer'),
  typedArrayByteOffset: getter(TypedArray.prototype, 'byteOffset'),
  typedArrayByteLength: getter(TypedArray.prototype, 'byteLength'),
  typedArrayLength: getter(TypedArray.prototype, 'length'),
  typedArrayName: getter(TypedArray.prototype, Symbol.toStringTag),
  arrayBufferByteLength: getter(ArrayBuffer.prototype, 'byteLength'),
  arrayBufferDetached: getter(ArrayBuffer.prototype, 'detached'),
  dataViewBuffer: getter(DataView.prototype, 'buffer'),
  dataViewByteOffset: getter(DataView.prototype, 'byteOffset'),
  dataViewByteLength: getter(DataView.prototype, 'byteLength'),
  arrayBufferTransfer: ArrayBuffer.prototype.transfer,
  dateValue: Date.prototype.valueOf
}

const typedArrays = {
  [enums.js_int8array]: Int8Array,
  [enums.js_uint8array]: Uint8Array,
  [enums.js_uint8clampedarray]: Uint8ClampedArray,
  [enums.js_int16array]: Int16Array,
  [enums.js_uint16array]: Uint16Array,
  [enums.js_int32array]: Int32Array,
  [enums.js_uint32array]: Uint32Array,
  [enums.js_float16array]: Float16Array,
  [enums.js_float32array]: Float32Array,
  [enums.js_float64array]: Float64Array,
  [enums.js_bigint64array]: BigInt64Array,
  [enums.js_biguint64array]: BigUint64Array
}

const typedArrayTypes = Object.fromEntries(
  Object.entries(typedArrays).map(([type, constructor]) => [constructor.name, Number(type)])
)

const errors = {
  error: Error,
  type_error: TypeError,
  range_error: RangeError,
  syntax_error: SyntaxError,
  reference_error: ReferenceError
}

const INT64_MIN = -(2n ** 63n)
const INT64_MAX = 2n ** 63n - 1n

exports.excluded = {}

exclude('Embedder API, not reachable from an addon', [
  'create_platform',
  'destroy_platform',
  'get_platform_identifier',
  'get_platform_version',
  'get_platform_limits',
  'create_env',
  'destroy_env',
  'get_env_platform',
  'on_uncaught_exception',
  'on_unhandled_rejection',
  'on_dynamic_import',
  'create_context',
  'destroy_context',
  'enter_context',
  'exit_context',
  'get_bindings',
  'terminate_execution',
  'create_inspector',
  'destroy_inspector',
  'on_inspector_response',
  'on_inspector_paused',
  'connect_inspector',
  'send_inspector_request',
  'attach_context_to_inspector',
  'detach_context_from_inspector'
])

exclude('WebAssembly addons have no event loop', ['get_platform_loop', 'get_env_loop'])

exclude('Compiles or evaluates code, which is left to the embedder', [
  'run_script',
  'prepare_script',
  'prepare_script_with_code_cache',
  'create_script_code_cache',
  'run_prepared_script',
  'delete_script',
  'get_script_name',
  'get_script_id',
  'on_script_dynamic_import',
  'create_module',
  'create_module_with_code_cache',
  'create_module_code_cache',
  'create_synthetic_module',
  'delete_module',
  'get_module_name',
  'get_module_id',
  'get_default_module_id',
  'get_module_namespace',
  'set_module_export',
  'instantiate_module',
  'run_module',
  'on_module_dynamic_import',
  'compile_function',
  'compile_function_with_code_cache',
  'create_function_code_cache',
  'create_function_with_source',
  'get_function_id',
  'on_function_dynamic_import'
])

exclude('Shared memory cannot be copied in and out of linear memory', [
  'create_arraybuffer_with_backing_store',
  'get_arraybuffer_backing_store',
  'create_sharedarraybuffer',
  'create_sharedarraybuffer_with_backing_store',
  'create_unsafe_sharedarraybuffer',
  'create_external_sharedarraybuffer',
  'get_sharedarraybuffer_backing_store',
  'release_arraybuffer_backing_store',
  'get_sharedarraybuffer_info'
])

exclude('WebAssembly addons are single threaded', [
  'create_threadsafe_function',
  'get_threadsafe_function_context',
  'call_threadsafe_function',
  'acquire_threadsafe_function',
  'release_threadsafe_function',
  'ref_threadsafe_function',
  'unref_threadsafe_function'
])

exclude('Engine introspection', [
  'enable_garbage_collection_tracking',
  'disable_garbage_collection_tracking',
  'get_heap_statistics',
  'get_heap_space_statistics',
  'get_error_location'
])

exclude('Typed functions always fall back to their untyped callback', ['get_typed_callback_info'])

exports.open_handle_scope = function (rt) {
  return rt.openScope()
}

exports.close_handle_scope = function (rt, scope) {
  rt.closeScope(scope)
}

exports.open_escapable_handle_scope = function (rt) {
  const slot = rt.handle(undefined)
  const depth = rt.openScope()

  rt.scopes[depth - 1].escape = slot

  return depth
}

exports.close_escapable_handle_scope = function (rt, scope) {
  rt.closeScope(scope)
}

exports.escape_handle = function (rt, scope, escapee) {
  const entry = rt.scopes[scope - 1]

  if (entry === undefined || entry.escape === undefined) {
    throw new TypeError('Invalid escapable handle scope')
  }
  if (entry.escaped) throw new Error('A handle has already been escaped from this scope')

  entry.escaped = true
  rt.handles[entry.escape] = escapee

  return rt.raw(entry.escape)
}

exports.create_reference = function (rt, value, count) {
  const reference = { id: rt.id(), count, value: undefined, weak: null }

  hold(reference, value)

  rt.references.set(reference.id, reference)

  return reference.id
}

exports.delete_reference = function (rt, reference) {
  rt.references.delete(reference.id)
}

exports.reference_ref = function (rt, reference) {
  if (reference.count++ === 0) hold(reference, deref(reference))

  return reference.count
}

exports.reference_unref = function (rt, reference) {
  if (reference.count > 0 && --reference.count === 0) hold(reference, deref(reference))

  return reference.count
}

exports.get_reference_value = function (rt, reference) {
  const value = deref(reference)

  return reference.weak !== null && value === undefined ? rt.raw(0) : value
}

exports.define_class = function (rt, name, len, constructor, data, properties, count) {
  const fn = rt.function(name, constructor, data)

  for (const property of descriptors(rt, properties, count)) {
    defineProperty(rt, property.attributes & enums.js_static ? fn : fn.prototype, property)
  }

  return fn
}

exports.define_properties = function (rt, object, properties, count) {
  for (const property of descriptors(rt, properties, count)) defineProperty(rt, object, property)
}

exports.wrap = function (rt, object, data, finalize, hint, want) {
  if (rt.wraps.has(object)) throw new Error('Object is already wrapped')

  const wrap = { data }

  rt.wraps.set(object, wrap)

  if (finalize !== 0) rt.finalizers.register(object, { cb: finalize, data, hint }, wrap)

  return want.result ? exports.create_reference(rt, object, 0) : 0
}

exports.unwrap = function (rt, object) {
  const wrap = rt.wraps.get(object)
  if (wrap === undefined) throw new TypeError('Object is not wrapped')
  return wrap.data
}

exports.remove_wrap = function (rt, object) {
  const data = exports.unwrap(rt, object)

  rt.finalizers.unregister(rt.wraps.get(object))
  rt.wraps.delete(object)

  return data
}

exports.add_finalizer = function (rt, object, data, finalize, hint, want) {
  rt.finalizer(object, finalize, data, hint)

  return want.result ? exports.create_reference(rt, object, 0) : 0
}

exports.add_type_tag = function (rt, object, tag) {
  if (rt.tags.has(object)) throw new Error('Object is already type tagged')

  const struct = rt.struct('js_type_tag_t', tag)

  rt.tags.set(object, { lower: struct.u64('lower'), upper: struct.u64('upper') })
}

exports.check_type_tag = function (rt, object, tag) {
  const existing = rt.tags.get(object)
  if (existing === undefined) return false

  const struct = rt.struct('js_type_tag_t', tag)

  return existing.lower === struct.u64('lower') && existing.upper === struct.u64('upper')
}

exports.create_int32 = (rt, value) => value
exports.create_uint32 = (rt, value) => value
exports.create_int64 = (rt, value) => Number(value)
exports.create_double = (rt, value) => value
exports.create_bigint_int64 = (rt, value) => value
exports.create_bigint_uint64 = (rt, value) => value

exports.create_bigint_words = function (rt, sign, words, len) {
  let value = 0n

  for (let i = len - 1; i >= 0; i--) {
    value = (value << 64n) | rt.view.getBigUint64(words + i * 8, true)
  }

  return sign ? -value : value
}

for (const encoding of ['utf8', 'utf16le', 'latin1']) {
  exports['create_string_' + encoding] = (rt, str) => str
  exports['create_property_key_' + encoding] = (rt, str) => str

  exports['create_external_string_' + encoding] = function (rt, str, len, finalize, hint) {
    const value = rt.read[encoding](str, len)

    rt.finalize({ cb: finalize, data: str, hint })

    return { result: value, copied: true }
  }
}

exports.create_symbol = (rt, description) => Symbol(description)
exports.symbol_for = (rt, description) => Symbol.for(description)
exports.create_object = () => ({})
exports.create_object_with_prototype = (rt, prototype) => Object.create(prototype)

exports.create_object_with_properties = function (rt, prototype, names, values, count) {
  const object = Object.create(prototype)

  for (let i = 0; i < count; i++) {
    Object.defineProperty(object, names[i], {
      value: values[i],
      writable: true,
      enumerable: true,
      configurable: true
    })
  }

  return object
}

exports.create_function = (rt, name, len, cb, data) => rt.function(name, cb, data)

exports.create_typed_function = (rt, name, len, cb, signature, address, data) =>
  rt.function(name, cb, data)

exports.create_array = () => []
exports.create_array_with_length = (rt, len) => new Array(len)
exports.create_array_with_elements = (rt, elements) => elements

exports.create_external = function (rt, data, finalize, hint) {
  const external = Object.freeze(Object.create(null))

  rt.externals.set(external, data)
  rt.finalizer(external, finalize, data, hint)

  return external
}

exports.create_date = (rt, time) => new Date(time)

for (const [name, constructor] of Object.entries(errors)) {
  exports['create_' + name] = function (rt, code, message) {
    const error = new constructor(message)
    if (code !== undefined) error.code = code
    return error
  }

  exports['throw_' + name] = function (rt, code, message) {
    rt.exception = { value: createError(constructor, code, message) }
  }

  exports['throw_' + name + 'f'] = function (rt, code, message, args) {
    rt.exception = { value: createError(constructor, code, format(rt, message, args)) }
  }

  exports['throw_' + name.replace('error', 'verrorf')] = exports['throw_' + name + 'f']
}

exports.create_promise = function (rt) {
  let deferred

  const promise = new Promise((resolve, reject) => {
    deferred = { resolve, reject }
  })

  const id = rt.id()

  rt.deferreds.set(id, deferred)

  return { deferred: id, promise }
}

exports.resolve_deferred = function (rt, deferred, resolution) {
  settle(rt, deferred).resolve(resolution)
}

exports.reject_deferred = function (rt, deferred, resolution) {
  settle(rt, deferred).reject(resolution)
}

exports.create_arraybuffer = function (rt, len, want) {
  const arraybuffer = new ArrayBuffer(len)

  return { result: arraybuffer, data: want.data ? rt.stage(new Uint8Array(arraybuffer)) : 0 }
}

exports.create_unsafe_arraybuffer = function (rt, len, want) {
  const arraybuffer = new ArrayBuffer(len)

  return {
    result: arraybuffer,
    data: want.data ? rt.stage(new Uint8Array(arraybuffer), { copy: false }) : 0
  }
}

// The contents are copied in when the handle scope closes, and the guest memory
// is finalized right after.
exports.create_external_arraybuffer = function (rt, data, len, finalize, hint) {
  const arraybuffer = new ArrayBuffer(len)

  rt.stage(new Uint8Array(arraybuffer), {
    ptr: data,
    copy: false,
    free: false,
    finalize: { cb: finalize, data, hint }
  })

  return arraybuffer
}

exports.detach_arraybuffer = function (rt, arraybuffer) {
  arrayBufferLength(rt, arraybuffer)
  intrinsics.arrayBufferTransfer.call(arraybuffer)
}

exports.get_arraybuffer_info = function (rt, arraybuffer, want) {
  const len = arrayBufferLength(rt, arraybuffer)

  return { data: want.data ? stage(rt, new Uint8Array(arraybuffer)) : 0, len }
}

exports.create_typedarray = function (rt, type, len, arraybuffer, offset) {
  const constructor = typedArrays[type]
  if (constructor === undefined) throw new TypeError(`Unknown typed array type ${type}`)
  return new constructor(arraybuffer, offset, len)
}

exports.create_dataview = (rt, len, arraybuffer, offset) => new DataView(arraybuffer, offset, len)

exports.get_typedarray_info = function (rt, typedarray, want) {
  if (!rt.type(typedarray).isTypedArray()) throw new TypeError('Value is not a typed array')

  const buffer = intrinsics.typedArrayBuffer.call(typedarray)
  const offset = intrinsics.typedArrayByteOffset.call(typedarray)

  return {
    type: typedArrayTypes[intrinsics.typedArrayName.call(typedarray)],
    len: intrinsics.typedArrayLength.call(typedarray),
    arraybuffer: buffer,
    offset,
    data: want.data
      ? stage(rt, new Uint8Array(buffer, offset, intrinsics.typedArrayByteLength.call(typedarray)))
      : 0
  }
}

exports.get_dataview_info = function (rt, dataview, want) {
  if (!rt.type(dataview).isDataView()) throw new TypeError('Value is not a data view')

  const buffer = intrinsics.dataViewBuffer.call(dataview)
  const offset = intrinsics.dataViewByteOffset.call(dataview)
  const len = intrinsics.dataViewByteLength.call(dataview)

  return {
    len,
    arraybuffer: buffer,
    offset,
    data: want.data ? stage(rt, new Uint8Array(buffer, offset, len)) : 0
  }
}

exports.coerce_to_boolean = (rt, value) => Boolean(value)
exports.coerce_to_number = (rt, value) => +value
exports.coerce_to_string = (rt, value) => `${value}`

exports.coerce_to_object = function (rt, value) {
  if (value === null || value === undefined) {
    throw new TypeError('Cannot convert undefined or null to object')
  }
  return Object(value)
}

exports.typeof = function (rt, value) {
  switch (typeof value) {
    case 'undefined':
      return enums.js_undefined
    case 'boolean':
      return enums.js_boolean
    case 'number':
      return enums.js_number
    case 'string':
      return enums.js_string
    case 'symbol':
      return enums.js_symbol
    case 'bigint':
      return enums.js_bigint
    case 'function':
      return enums.js_function
  }

  if (value === null) return enums.js_null
  if (rt.externals.has(value)) return enums.js_external

  return enums.js_object
}

exports.instanceof = (rt, object, constructor) => object instanceof constructor

const predicates = {
  undefined: 'isUndefined',
  null: 'isNull',
  boolean: 'isBoolean',
  boolean_object: 'isBooleanObject',
  number: 'isNumber',
  number_object: 'isNumberObject',
  int32: 'isInt32',
  uint32: 'isUint32',
  string: 'isString',
  string_object: 'isStringObject',
  symbol: 'isSymbol',
  symbol_object: 'isSymbolObject',
  object: 'isObject',
  function: 'isFunction',
  async_function: 'isAsyncFunction',
  generator_function: 'isGeneratorFunction',
  generator: 'isGenerator',
  arguments: 'isArguments',
  array: 'isArray',
  bigint: 'isBigInt',
  bigint_object: 'isBigIntObject',
  date: 'isDate',
  regexp: 'isRegExp',
  error: 'isError',
  promise: 'isPromise',
  proxy: 'isProxy',
  map: 'isMap',
  set: 'isSet',
  weak_map: 'isWeakMap',
  weak_set: 'isWeakSet',
  weak_ref: 'isWeakRef',
  arraybuffer: 'isArrayBuffer',
  sharedarraybuffer: 'isSharedArrayBuffer',
  typedarray: 'isTypedArray',
  int8array: 'isInt8Array',
  uint8array: 'isUint8Array',
  uint8clampedarray: 'isUint8ClampedArray',
  int16array: 'isInt16Array',
  uint16array: 'isUint16Array',
  int32array: 'isInt32Array',
  uint32array: 'isUint32Array',
  float16array: 'isFloat16Array',
  float32array: 'isFloat32Array',
  float64array: 'isFloat64Array',
  bigint64array: 'isBigInt64Array',
  biguint64array: 'isBigUint64Array',
  dataview: 'isDataView',
  module_namespace: 'isModuleNamespace'
}

for (const [name, predicate] of Object.entries(predicates)) {
  exports['is_' + name] = (rt, value) => rt.type(value)[predicate]()
}

exports.is_external = (rt, value) => rt.externals.has(value)
exports.is_wrapped = (rt, value) => rt.wraps.has(value)
exports.is_delegate = () => false

exports.is_detached_arraybuffer = (rt, value) =>
  rt.type(value).isArrayBuffer() && intrinsics.arrayBufferDetached.call(value)

exports.strict_equals = (rt, a, b) => a === b

exports.get_global = () => globalThis
exports.get_undefined = () => undefined
exports.get_null = () => null
exports.get_boolean = (rt, value) => value

exports.get_value_bool = (rt, value) => expect(value, 'boolean')
exports.get_value_int32 = (rt, value) => expect(value, 'number') | 0
exports.get_value_uint32 = (rt, value) => expect(value, 'number') >>> 0
exports.get_value_double = (rt, value) => expect(value, 'number')

exports.get_value_int64 = function (rt, value) {
  expect(value, 'number')

  if (Number.isNaN(value)) return 0n
  if (value === Infinity) return INT64_MAX
  if (value === -Infinity) return INT64_MIN

  const result = BigInt(Math.trunc(value))

  return result < INT64_MIN ? INT64_MIN : result > INT64_MAX ? INT64_MAX : result
}

exports.get_value_bigint_int64 = function (rt, value) {
  const result = BigInt.asIntN(64, expect(value, 'bigint'))
  return { result, lossless: result === value }
}

exports.get_value_bigint_uint64 = function (rt, value) {
  const result = BigInt.asUintN(64, expect(value, 'bigint'))
  return { result, lossless: result === value }
}

exports.get_value_bigint_words = function (rt, value, sign, words, len) {
  expect(value, 'bigint')

  let magnitude = value < 0n ? -value : value
  let count = 0

  for (let rest = magnitude; rest > 0n; rest >>= 64n) count++

  if (sign === 0 && words === 0) return count

  rt.write.i32(sign, value < 0n ? 1 : 0)

  let written = 0

  for (; written < len && written < count; written++) {
    rt.view.setBigUint64(words + written * 8, magnitude & 0xffffffffffffffffn, true)
    magnitude >>= 64n
  }

  return written
}

for (const [encoding, width] of [
  ['utf8', 1],
  ['utf16le', 2],
  ['latin1', 1]
]) {
  exports['get_value_string_' + encoding] = function (rt, value, str, len) {
    const bytes = Buffer.from(expect(value, 'string'), encoding)

    if (str === 0) return bytes.byteLength / width

    const units = Math.min(len, bytes.byteLength / width)

    rt.bytes.set(bytes.subarray(0, units * width), str)

    if (units < len) rt.bytes.fill(0, str + units * width, str + (units + 1) * width)

    return units
  }
}

exports.get_value_external = function (rt, value) {
  const data = rt.externals.get(value)
  if (data === undefined) throw new TypeError('Value is not an external')
  return data
}

exports.get_value_date = (rt, value) => intrinsics.dateValue.call(value)

exports.get_array_length = function (rt, array) {
  if (!Array.isArray(array)) throw new TypeError('Value is not an array')
  return array.length
}

exports.get_array_elements = function (rt, array, elements, len, offset) {
  const count = Math.max(0, Math.min(len, exports.get_array_length(rt, array) - offset))

  for (let i = 0; i < count; i++) rt.write.value(elements + i * 4, array[offset + i])

  return count
}

exports.set_array_elements = function (rt, array, elements, len, offset) {
  for (let i = 0; i < len; i++) array[offset + i] = elements[i]
}

exports.get_prototype = (rt, object) => Reflect.getPrototypeOf(object)
exports.set_prototype = (rt, object, prototype) => Reflect.setPrototypeOf(object, prototype)
exports.seal = (rt, object) => Object.seal(object)
exports.freeze = (rt, object) => Object.freeze(object)

exports.get_property_names = function (rt, object) {
  const names = []
  for (const name in object) names.push(name)
  return names
}

exports.get_filtered_property_names = function (rt, object, mode, filter, indices, conversion) {
  const names = []
  const seen = new Set()

  for (let target = object; target !== null; target = Reflect.getPrototypeOf(target)) {
    for (const key of Reflect.ownKeys(target)) {
      if (seen.has(key)) continue
      seen.add(key)

      const isSymbol = typeof key === 'symbol'
      const isIndex = !isSymbol && String(key >>> 0) === key && key >>> 0 !== 0xffffffff

      if (isSymbol && filter & enums.js_property_skip_symbols) continue
      if (!isSymbol && !isIndex && filter & enums.js_property_skip_strings) continue
      if (isIndex && indices === enums.js_index_skip_indices) continue

      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)

      if (filter & enums.js_writable && !descriptor.writable) continue
      if (filter & enums.js_enumerable && !descriptor.enumerable) continue
      if (filter & enums.js_configurable && !descriptor.configurable) continue

      names.push(isIndex && conversion === enums.js_key_keep_numbers ? Number(key) : key)
    }

    if (mode === enums.js_key_own_only) break
  }

  return names
}

exports.get_property = (rt, object, key) => object[key]
exports.has_property = (rt, object, key) => key in object
exports.has_own_property = (rt, object, key) => Object.hasOwn(object, key)
exports.set_property = (rt, object, key, value) => {
  object[key] = value
}
exports.delete_property = (rt, object, key) => Reflect.deleteProperty(object, key)

exports.get_named_property = exports.get_property
exports.has_named_property = exports.has_property
exports.set_named_property = exports.set_property
exports.delete_named_property = exports.delete_property

exports.get_element = exports.get_property
exports.has_element = exports.has_property
exports.set_element = exports.set_property
exports.delete_element = exports.delete_property

exports.get_string_view = function (rt, string) {
  expect(string, 'string')

  const encoding = /^[\0-\xff]*$/.test(string) ? 'latin1' : 'utf16le'
  const bytes = Buffer.from(string, encoding)
  const ptr = rt.malloc(bytes.byteLength)
  const id = rt.id()

  rt.bytes.set(bytes, ptr)
  rt.views.set(id, ptr)

  return { encoding: enums['js_' + encoding], str: ptr, len: string.length, result: id }
}

exports.release_string_view = function (rt, view) {
  const ptr = rt.views.get(view)
  if (ptr === undefined) throw new TypeError('Invalid string view')

  rt.views.delete(view)
  rt.free(ptr)
}

exports.get_callback_info = function (rt, id, argc, argv) {
  const info = rt.info(id)

  if (argv !== 0) {
    const room = argc === 0 ? 0 : rt.view.getUint32(argc, true)

    for (let i = 0; i < room; i++) rt.write.value(argv + i * 4, info.args[i])
  }

  if (argc !== 0) rt.write.u32(argc, info.args.length)

  return { receiver: info.receiver, data: info.data }
}

exports.get_new_target = (rt, id) => rt.info(id).newTarget

exports.call_function = (rt, receiver, fn, argc, argv) =>
  rt.around(() => Reflect.apply(fn, receiver, argv))

exports.call_function_with_checkpoint = exports.call_function

exports.new_instance = (rt, constructor, argc, argv) =>
  rt.around(() => Reflect.construct(constructor, argv))

exports.queue_microtask = (rt, fn) => queueMicrotask(fn)

exports.queue_microtask_with_callback = function (rt, cb, data) {
  queueMicrotask(() => rt.finalize({ cb, data, hint: 0 }))
}

exports.throw = function (rt, error) {
  rt.exception = { value: error }
}

exports.is_exception_pending = (rt) => rt.exception !== null

exports.get_and_clear_last_exception = function (rt) {
  if (rt.exception === null) return undefined

  const { value } = rt.exception

  rt.exception = null

  return value
}

exports.fatal_exception = function (rt, error) {
  queueMicrotask(() => {
    throw error
  })
}

exports.adjust_external_memory = function (rt, change) {
  rt.externalMemory = (rt.externalMemory || 0n) + change

  return rt.externalMemory
}

exports.request_garbage_collection = () => {}

function exclude(reason, names) {
  for (const name of names) exports.excluded[name] = reason
}

function getter(object, key) {
  return Object.getOwnPropertyDescriptor(object, key).get
}

function expect(value, type) {
  if (typeof value !== type) throw new TypeError(`Value is not a ${type}`)
  return value
}

function hold(reference, value) {
  const weak =
    reference.count === 0 &&
    ((typeof value === 'object' && value !== null) || typeof value === 'function')

  reference.value = weak ? undefined : value
  reference.weak = weak ? new WeakRef(value) : null
}

function deref(reference) {
  return reference.weak === null ? reference.value : reference.weak.deref()
}

function settle(rt, id) {
  const deferred = rt.deferreds.get(id)
  if (deferred === undefined) throw new TypeError('Invalid deferred')
  rt.deferreds.delete(id)
  return deferred
}

function arrayBufferLength(rt, arraybuffer) {
  if (!rt.type(arraybuffer).isArrayBuffer()) throw new TypeError('Value is not an array buffer')
  return intrinsics.arrayBufferByteLength.call(arraybuffer)
}

function stage(rt, target) {
  return rt.staged(target) || rt.stage(target)
}

function createError(constructor, code, message) {
  const error = new constructor(message === null ? undefined : message)
  if (code !== null) error.code = code
  return error
}

function* descriptors(rt, ptr, count) {
  const { size } = rt.layouts.js_property_descriptor_t

  for (let i = 0; i < count; i++) {
    const struct = rt.struct('js_property_descriptor_t', ptr + i * size)

    yield {
      name: rt.value(struct.u32('name')),
      data: struct.u32('data'),
      attributes: struct.i32('attributes'),
      method: struct.u32('method'),
      getter: struct.u32('getter'),
      setter: struct.u32('setter'),
      value: struct.u32('value')
    }
  }
}

function defineProperty(rt, object, property) {
  const { name, data, attributes, method, getter, setter, value } = property

  const descriptor = {
    enumerable: (attributes & enums.js_enumerable) !== 0,
    configurable: (attributes & enums.js_configurable) !== 0
  }

  if (getter !== 0 || setter !== 0) {
    if (getter !== 0) descriptor.get = rt.function(null, getter, data)
    if (setter !== 0) descriptor.set = rt.function(null, setter, data)
  } else {
    descriptor.writable = (attributes & enums.js_writable) !== 0
    descriptor.value = method !== 0 ? rt.function(null, method, data) : rt.value(value)
  }

  Object.defineProperty(object, name, descriptor)
}

// A subset of printf(). On wasm32, variadic arguments are laid out in a buffer,
// each aligned to its own size.
function format(rt, message, args) {
  let offset = args

  const next = (size) => {
    offset = Math.ceil(offset / size) * size
    const at = offset
    offset += size
    return at
  }

  return message.replace(
    /%([-+ 0#]*)(\d*)(?:\.(\d+))?(hh|h|ll|l|z|j|t)?([diouxXcsfFeEgGp%])/g,
    (match, flags, width, precision, length, conversion) => {
      let text

      switch (conversion) {
        case '%':
          return '%'
        case 's':
          text = rt.read.utf8(rt.view.getUint32(next(4), true), rt.NUL_TERMINATED)
          if (precision !== undefined) text = text.slice(0, Number(precision))
          break
        case 'c':
          text = String.fromCharCode(rt.view.getInt32(next(4), true))
          break
        case 'f':
        case 'F':
        case 'e':
        case 'E':
        case 'g':
        case 'G': {
          const value = rt.view.getFloat64(next(8), true)
          const digits = precision === undefined ? 6 : Number(precision)
          text = /[fF]/.test(conversion)
            ? value.toFixed(digits)
            : /[eE]/.test(conversion)
              ? value.toExponential(digits)
              : String(Number(value.toPrecision(digits || 1)))
          break
        }
        case 'p':
          text = '0x' + rt.view.getUint32(next(4), true).toString(16)
          break
        default: {
          const wide = length === 'll' || length === 'j'
          const signed = conversion === 'd' || conversion === 'i'
          const at = next(wide ? 8 : 4)
          const value = wide
            ? signed
              ? rt.view.getBigInt64(at, true)
              : rt.view.getBigUint64(at, true)
            : signed
              ? rt.view.getInt32(at, true)
              : rt.view.getUint32(at, true)
          const radix = conversion === 'o' ? 8 : /[xX]/.test(conversion) ? 16 : 10
          text = value.toString(radix)
          if (conversion === 'X') text = text.toUpperCase()
        }
      }

      const pad = flags.includes('0') && !flags.includes('-') ? '0' : ' '
      return flags.includes('-')
        ? text.padEnd(Number(width) || 0)
        : text.padStart(Number(width) || 0, pad)
    }
  )
}
