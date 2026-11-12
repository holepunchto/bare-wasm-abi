const { enums } = require('./constants')

const typedArrayTypes = [
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float16Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array'
].reduce((types, name) => ({ ...types, [name]: enums['js_' + name.toLowerCase()] }), {})

const errors = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError']

let host = null

module.exports = exports = function createRealm(realm = null) {
  if (realm === null) return (host ??= capture(globalThis, evaluate))

  return capture(realm.evaluate('globalThis'), (source, filename, offset) =>
    realm.evaluate(source, { filename, offset })
  )
}

exports.typedArrayTypes = typedArrayTypes

// The constructors are captured up front so that an addon patching its own
// realm cannot change how the ABI creates values. Values made by the
// constructors of another realm would lead back to that realm instead.
function capture(global, evaluate) {
  const from = global.Array.from

  return {
    global,
    evaluate,
    Object: global.Object,
    Array: global.Array,
    Date: global.Date,
    Promise: global.Promise,
    then: global.Promise.prototype.then,
    ArrayBuffer: global.ArrayBuffer,
    DataView: global.DataView,
    Function: global.Function,
    Symbol: global.Symbol,
    create: global.Object.create,
    array: (values) => Reflect.apply(from, global.Array, [values]),
    // Every operation on a value of the addon must run in its realm. Code it
    // calls in the realm, such as a getter or a proxy trap, is otherwise handed
    // argument lists and descriptors made in the realm of the caller.
    Reflect: Object.fromEntries(
      Reflect.ownKeys(Reflect).map((name) => [name, global.Reflect[name]])
    ),
    defineProperty: global.Object.defineProperty,
    hasOwn: global.Object.hasOwn,
    seal: global.Object.seal,
    freeze: global.Object.freeze,
    get: new global.Function('object', 'key', 'return object[key]'),
    set: new global.Function('object', 'key', 'value', 'object[key] = value'),
    has: new global.Function('object', 'key', 'return key in object'),
    instanceOf: new global.Function(
      'object',
      'constructor',
      'return object instanceof constructor'
    ),
    toString: new global.Function('value', 'return `${value}`'),
    toNumber: new global.Function('value', 'return +value'),
    keys: new global.Function(
      'object',
      'const keys = []; for (const key in object) keys.push(key); return keys'
    ),
    function: new global.Function(
      'invoke',
      'return function (...args) { return invoke(this, args, new.target) }'
    ),
    typedArrays: Object.fromEntries(
      Object.entries(typedArrayTypes).map(([name, type]) => [type, global[name]])
    ),
    errors: Object.fromEntries(errors.map((name) => [name, global[name]]))
  }
}

// Without a realm of its own the addon shares the host realm, which offers no
// way to run a script from JavaScript. Indirect eval comes closest, though
// top-level lexical declarations do not outlive the call.
function evaluate(source, filename, offset) {
  let code = '\n'.repeat(Math.max(offset, 0)) + source

  if (filename) code += '\n//# sourceURL=' + filename

  return (0, eval)(code)
}
