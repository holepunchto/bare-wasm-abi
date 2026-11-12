const intrinsics = require('./intrinsics')
const { typedArrayTypes } = require('./realm')

const errors = { Error, TypeError, RangeError, SyntaxError, ReferenceError }

// Code outside the realm of an addon must never touch its objects directly, as
// reading a property, converting a value, or logging it runs code of the realm
// with arguments made outside it. Values therefore cross as copies, read with
// the operations of the realm, and functions cross wrapped.
module.exports = class Boundary {
  constructor(rt) {
    this.rt = rt
    this.wrappers = new WeakMap()
    this.originals = new WeakMap()
  }

  toHost(value, copies = new Map()) {
    const { rt } = this

    if (!rt.isObject(value)) return value
    if (this.originals.has(value)) return this.originals.get(value)
    if (copies.has(value)) return copies.get(value)
    if (typeof value === 'function') return this.wrap(value, (fn) => this.hostFunction(fn))

    const { realm } = rt
    const type = rt.type(value)

    if (type.isPromise()) return this.hostPromise(value)
    if (type.isArrayBuffer()) return new Uint8Array(value).slice().buffer
    if (type.isDataView()) {
      const { dataViewBuffer, dataViewByteOffset, dataViewByteLength } = intrinsics

      return new DataView(copyBytes(value, dataViewBuffer, dataViewByteOffset, dataViewByteLength))
    }
    if (type.isDate()) return new Date(intrinsics.dateValue.call(value))

    if (type.isTypedArray()) {
      const name = intrinsics.typedArrayName.call(value)

      const { typedArrayBuffer, typedArrayByteOffset, typedArrayByteLength } = intrinsics

      return new globalThis[name](
        copyBytes(value, typedArrayBuffer, typedArrayByteOffset, typedArrayByteLength)
      )
    }

    if (type.isError()) {
      const name = realm.get(value, 'name')
      const message = realm.get(value, 'message')

      return new (Object.hasOwn(errors, name) ? errors[name] : Error)(
        typeof message === 'string' ? message : undefined
      )
    }

    const copy = type.isArray() ? [] : {}

    copies.set(value, copy)

    const keys = realm.Reflect.ownKeys(value)

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]

      if (typeof key !== 'string') continue

      const descriptor = realm.Reflect.getOwnPropertyDescriptor(value, key)

      if (descriptor === undefined || !realm.get(descriptor, 'enumerable')) continue

      define(copy, key, this.toHost(realm.get(value, key), copies))
    }

    return copy
  }

  toRealm(value, copies = new Map()) {
    const { rt } = this

    if (!rt.isObject(value)) return value
    if (this.originals.has(value)) return this.originals.get(value)
    if (rt.owns(value)) return value
    if (copies.has(value)) return copies.get(value)
    if (typeof value === 'function') return this.wrap(value, (fn) => this.realmFunction(fn))

    const { realm } = rt
    const type = rt.type(value)

    if (type.isPromise()) return this.realmPromise(value)
    if (type.isArrayBuffer()) return realmBytes(rt, new Uint8Array(value))
    if (type.isDate()) return new realm.Date(value.valueOf())

    if (type.isDataView()) {
      return new realm.DataView(
        realmBytes(rt, new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      )
    }

    if (type.isTypedArray()) {
      const bytes = realmBytes(rt, new Uint8Array(value.buffer, value.byteOffset, value.byteLength))

      return realm.Reflect.construct(
        realm.typedArrays[typedArrayTypes[value[Symbol.toStringTag]]],
        [bytes]
      )
    }

    if (type.isError()) {
      return realm.Reflect.construct(
        Object.hasOwn(realm.errors, value.name) ? realm.errors[value.name] : realm.errors.Error,
        [value.message]
      )
    }

    const copy = type.isArray() ? new realm.Array() : new realm.Object()

    copies.set(value, copy)

    for (const key of Object.keys(value)) {
      realm.defineProperty(copy, key, {
        value: this.toRealm(value[key], copies),
        writable: true,
        enumerable: true,
        configurable: true
      })
    }

    return copy
  }

  wrap(fn, create) {
    let wrapper = this.wrappers.get(fn)

    if (wrapper === undefined) {
      wrapper = create(fn)

      this.wrappers.set(fn, wrapper)
      this.originals.set(wrapper, fn)
    }

    return wrapper
  }

  hostFunction(fn) {
    return (...args) => {
      let result

      try {
        result = this.rt.realm.Reflect.apply(
          fn,
          undefined,
          args.map((arg) => this.toRealm(arg))
        )
      } catch (err) {
        throw this.toHost(err)
      }

      return this.toHost(result)
    }
  }

  realmFunction(fn) {
    return this.rt.realm.function((receiver, args) => {
      const list = []

      for (let i = 0; i < args.length; i++) list.push(this.toHost(args[i]))

      let result

      try {
        result = Reflect.apply(fn, undefined, list)
      } catch (err) {
        throw this.toRealm(err)
      }

      return this.toRealm(result)
    })
  }

  // The handlers are host functions and must not throw back into the realm, as
  // the promise they would reject is one the code of the realm may control.
  hostPromise(promise) {
    return new Promise((resolve, reject) => {
      const settle = (fn) => (value) => {
        try {
          fn(this.toHost(value))
        } catch (err) {
          reject(err)
        }
      }

      this.rt.realm.Reflect.apply(this.rt.realm.then, promise, [settle(resolve), settle(reject)])
    })
  }

  realmPromise(promise) {
    let settle

    const result = new this.rt.realm.Promise((resolve, reject) => {
      settle = { resolve, reject }
    })

    const forward = (fn) => (value) => {
      try {
        fn(this.toRealm(value))
      } catch (err) {
        settle.reject(this.toRealm(err))
      }
    }

    promise.then(forward(settle.resolve), forward(settle.reject))

    return result
  }
}

function define(object, key, value) {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  })
}

function copyBytes(view, buffer, byteOffset, byteLength) {
  const bytes = new Uint8Array(buffer.call(view), byteOffset.call(view), byteLength.call(view))

  return bytes.slice().buffer
}

function realmBytes(rt, bytes) {
  const buffer = new rt.realm.ArrayBuffer(bytes.byteLength)

  new Uint8Array(buffer).set(bytes)

  return buffer
}
