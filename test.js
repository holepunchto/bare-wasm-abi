const { test, hook } = require('brittle')
const fs = require('bare-fs')
const path = require('bare-path')
const wasm = require('bare-wasm')
const Realm = require('bare-realm')
const { spawnSync } = require('bare-subprocess')
const instantiate = require('.')
const loadRaw = require('./lib/load')
const Runtime = require('./lib/runtime')
const { enums } = require('./lib/constants')
const { build, configure, compile } = require('./scripts/build')

hook('build the fixtures', { timeout: 10 * 60 * 1000 }, async () => {
  await configure()
  await compile()
})

function load(name, opts) {
  return instantiate(fs.readFileSync(path.join(build, `${name}.wasm`)), opts)
}

// The values of an addon in its own realm, as the ABI sees them before they are
// copied out for the host.
function loadInRealm(name) {
  const realm = new Realm()
  const { exports } = loadRaw(fs.readFileSync(path.join(build, `${name}.wasm`)), { realm })

  return { realm, global: realm.evaluate('globalThis'), addon: exports }
}

test('numbers', (t) => {
  const addon = load('values')

  t.is(addon.add(2, 40), 42)
  t.is(addon.add(-2, -40), -42)
  t.is(addon.scale(1.5, 4), 6)
  t.is(addon.negate(2n ** 62n), -(2n ** 62n))
})

test('strings', (t) => {
  const addon = load('values')

  t.is(addon.concat('hello ', 'world'), 'hello world')
  t.is(addon.concat('æøå ', '日本'), 'æøå 日本')
  t.is(addon.reverse('abc'), 'cba')
  t.is(addon.reverse('Ωμέγα'), 'αγέμΩ')
})

test('objects', (t) => {
  const addon = load('values')

  t.alike(addon.pair('answer', 42), { answer: 42 })
})

test('calling back into JavaScript', (t) => {
  const addon = load('values')

  t.is(
    addon.invoke((x) => x * 2, 21),
    42
  )
  t.exception(
    () =>
      addon.invoke(() => {
        throw new Error('from the callback')
      }, 0),
    /from the callback/
  )
})

test('thrown errors', (t) => {
  const addon = load('values')

  try {
    addon.fail('boom')
    t.fail('should throw')
  } catch (err) {
    t.is(err.message, 'boom')
    t.is(err.code, 'ERR_FIXTURE')
  }
})

test('typed arrays are written back after the call', (t) => {
  const addon = load('values')

  const buffer = new Uint8Array(16)
  addon.fill(buffer, 7)

  t.alike(buffer, new Uint8Array(16).fill(7))

  const view = new Uint8Array(new ArrayBuffer(32), 8, 4)
  addon.fill(view, 1)

  t.alike(new Uint8Array(view.buffer), new Uint8Array(32).fill(1, 8, 12))
})

test('detachable array buffers', (t) => {
  const addon = load('values')

  t.ok(addon.isDetachable(new ArrayBuffer(8)))
  t.absent(addon.isDetachable(new wasm.Memory({ initial: 1 }).buffer))
  t.absent(addon.isDetachable(new Uint8Array(8)))
})

test('object types', (t) => {
  const addon = load('values')

  t.is(addon.objectType(new Map().keys()), enums.js_map_iterator)
  t.is(addon.objectType(new Set().values()), enums.js_set_iterator)
  t.is(addon.objectType(new Uint8Array(8)), enums.js_typedarray, 'typed array')
  t.is(addon.objectType(new wasm.Memory({ initial: 1 }).buffer), enums.js_arraybuffer, 'memory')
  t.is(
    addon.objectType(() => {}),
    enums.js_object,
    'function'
  )
  t.is(addon.objectType(undefined), enums.js_external, 'external')
  t.exception.all(() => addon.objectType(42), /Value is not an object/)
})

test('map and set iterators', (t) => {
  const addon = load('values')

  t.is(addon.iteratorKind(new Map().entries()), 'map')
  t.is(addon.iteratorKind(new Set().entries()), 'set')
  t.is(addon.iteratorKind([].entries()), 'none')
  t.is(addon.iteratorKind(new Map()), 'none')
})

test('staged buffers are synced around getters', (t) => {
  const addon = load('values')

  const view = new Uint8Array(2)

  const result = addon.observe(view, {
    get probe() {
      const seen = view[0]
      view[1] = 2
      return seen
    }
  })

  t.alike(result, [1, 2])
})

test('typeof', (t) => {
  const addon = load('values')

  t.is(addon.typeOf(undefined), 'undefined')
  t.is(addon.typeOf(null), 'null')
  t.is(addon.typeOf(true), 'boolean')
  t.is(addon.typeOf(1), 'number')
  t.is(addon.typeOf('a'), 'string')
  t.is(addon.typeOf(Symbol('a')), 'symbol')
  t.is(addon.typeOf({}), 'object')
  t.is(
    addon.typeOf(() => {}),
    'function'
  )
  t.is(addon.typeOf(1n), 'bigint')
})

test('a trap is contained to the addon instance', (t) => {
  const addon = load('trap')
  const other = load('values')

  t.exception.all(() => addon.trap(), wasm.RuntimeError)
  t.exception(() => addon.trap(), /WebAssembly addon has crashed/)
  t.is(other.add(1, 2), 3, 'other instances keep working')
})

test('a trap in a nested call stops the frames that called it', (t) => {
  const addon = load('trap')

  t.exception.all(() => addon.invoke(() => addon.trap()), wasm.RuntimeError)
})

test('values created by the addon belong to its realm', (t) => {
  const { global, addon } = loadInRealm('realm')

  t.ok(Realm.isFrom(addon, global), 'exports')
  t.ok(Realm.isFrom(addon.create, global), 'functions')

  const { global: addonGlobal, ...values } = addon.create()

  t.is(addonGlobal, global, 'global')

  for (const [name, value] of Object.entries(values)) t.ok(Realm.isFrom(value, global), name)
})

test('errors raised by the ABI belong to the realm of the addon', (t) => {
  const { global, addon } = loadInRealm('realm')

  const err = addon.misuse()

  t.ok(err instanceof global.TypeError)
  t.is(err.message, 'Value is not a number')
})

test('values from another realm are kept from the addon', (t) => {
  const { global, addon } = loadInRealm('realm')

  const inner = global.Object()

  t.is(addon.identity(inner), inner)
  t.is(addon.identity(42), 42)
  t.exception(() => addon.identity({}), /Value belongs to another realm/)
  t.exception(() => addon.identity(() => {}), /Value belongs to another realm/)
})

test('classes cannot be constructed for another realm', (t) => {
  const { global, addon } = loadInRealm('realm')

  const { class: Class } = addon.create()

  class Subclass extends Class {}

  t.ok(Realm.isFrom(new Class(), global))
  t.exception.all(() => new Subclass(), /The new.target belongs to another realm/)
  t.exception.all(
    () => Reflect.construct(Class, [], function Host() {}),
    /The new.target belongs to another realm/
  )
})

test('errors the engine raises for the ABI are kept from the addon', (t) => {
  const { global, addon } = loadInRealm('realm')

  const err = addon.outOfBounds()

  t.ok(err instanceof global.Error)
  t.absent(err instanceof RangeError)
  t.ok(/outside the bounds/.test(err.message), 'keeps the message of the engine')
})

test('the global of an object is the global of its realm', (t) => {
  const global = new Realm().evaluate('globalThis')
  const addon = load('realm')

  t.is(addon.globalOf(global.Object()), global)
  t.is(addon.globalOf({}), globalThis)
})

test('code in the realm only sees values from the realm when the ABI calls it', (t) => {
  const { realm, global, addon } = loadInRealm('realm')

  const { targets, calls } = realm.evaluate(`(() => {
    const log = new Map()
    const spy = (name, fn) => new Proxy(fn, {
      apply (target, self, args) {
        log.set(log.size, [name, args])
        return Reflect.apply(target, self, args)
      }
    })
    const handler = {}
    for (const name of Reflect.ownKeys(Reflect)) {
      if (typeof Reflect[name] === 'function') handler[name] = spy(name, Reflect[name])
    }
    Object.defineProperty(Array.prototype, 5, { get: spy('index', () => {}), configurable: true })
    Object.defineProperty(Error.prototype, 'code', { set: spy('code', () => {}), configurable: true })
    return {
      targets: [new Proxy(function () {}, handler), new Proxy([], handler)],
      calls: () => [...log.values()]
    }
  })()`)

  for (const target of targets) addon.operate(target)

  const names = new Set()
  const foreign = []

  for (const [name, args] of calls()) {
    names.add(name)

    for (const value of [args, ...args]) {
      if (value === Object(value) && !Realm.isFrom(value, global)) foreign.push(name)
    }
  }

  t.alike(foreign, [], 'every call was handed values from the realm')
  t.ok(names.has('apply') && names.has('construct') && names.has('defineProperty'))
  t.ok(names.has('get') && names.has('set') && names.has('code'))
})

test('errors leaving the addon belong to its realm', (t) => {
  const { realm, global, addon } = loadInRealm('trap')

  global.trap = addon.trap

  const caught = () => realm.evaluate('(() => { try { trap() } catch (err) { return err } })()')

  const trapped = caught()
  const crashed = caught()

  t.ok(Realm.isFrom(trapped, global), 'the trap')
  t.ok(Realm.isFrom(crashed, global), 'the crashed addon')
  t.ok(/has crashed/.test(crashed.message))
})

test('scripts run in the realm of the addon', (t) => {
  const { global, addon } = loadInRealm('realm')

  t.is(addon.run('globalThis'), global)
  t.is(load('realm').run('globalThis'), globalThis)
})

test('scripts share top-level declarations', (t) => {
  const { addon } = loadInRealm('realm')

  addon.run('let shared = 42')

  t.is(addon.run('shared'), 42)
})

test('scripts are named and offset in stack traces', (t) => {
  const { addon } = loadInRealm('realm')

  t.ok(addon.run('new Error().stack').includes('at script.js:11:'))
})

test('prepared scripts can run more than once', (t) => {
  const { addon } = loadInRealm('realm')

  const [first, second, name] = addon.runPrepared('globalThis.count = (globalThis.count || 0) + 1')

  t.is(first, 1)
  t.is(second, 2)
  t.is(name, 'prepared.js')
})

test('compiled functions run in the realm of the addon', (t) => {
  const { global, addon } = loadInRealm('realm')

  const add = addon.compile('return a + b')

  t.is(add(1, 2), 3)
  t.is(add.name, 'add')
  t.ok(Realm.isFrom(add, global))
  t.ok(addon.compile('return new Error().stack')().includes('(function.js:6:'))
})

test('compiled functions cannot escape their body', (t) => {
  const { realm, global, addon } = loadInRealm('realm')

  t.exception(
    () => addon.compile('}); globalThis.escaped = true; (function () {'),
    global.SyntaxError
  )
  t.absent(realm.evaluate('globalThis.escaped'))
})

test('the host only sees copies of the values of an addon in its own realm', (t) => {
  const realm = new Realm()
  const global = realm.evaluate('globalThis')
  const addon = load('realm', { realm })

  const value = addon.run(`
    globalThis.leaked = false
    const read = new Proxy(function () {}, {
      apply (target, self, args) {
        if (!(args instanceof Array)) leaked = true
        return 'read'
      }
    })
    const object = { array: [1, 2], bytes: new Uint8Array([3, 4]), date: new Date(0) }
    Object.defineProperty(object, 'getter', { get: read, enumerable: true })
    object.self = object
    object
  `)

  t.absent(Realm.isFrom(value, global))
  t.is(value.getter, 'read')
  t.alike(value.array, [1, 2])
  t.alike(value.bytes, new Uint8Array([3, 4]))
  t.is(value.date.getTime(), 0)
  t.is(value.self, value)
  t.absent(realm.evaluate('leaked'), 'the getter only ran with values from its realm')
})

test('functions cross the realm boundary wrapped', (t) => {
  const realm = new Realm()
  const global = realm.evaluate('globalThis')
  const values = load('values', { realm })

  t.absent(Realm.isFrom(values.invoke, global))
  t.is(
    values.invoke((x) => x * 2, 21),
    42
  )
  t.exception(
    () =>
      values.invoke(() => {
        throw new Error('from the host')
      }, 0),
    /from the host/
  )

  const fn = () => {}

  t.is(load('realm', { realm }).identity(fn), fn)
})

test('promises cross the realm boundary', async (t) => {
  const addon = load('realm', { realm: new Realm() })

  t.alike(await addon.run('Promise.resolve({ value: 42 })'), { value: 42 })
  await t.exception(addon.run("Promise.reject(new Error('rejected'))"), /rejected/)
})

test('fatal exceptions from an addon in its own realm reach the host as copies', (t) => {
  const { stdout } = spawnSync(Bare.argv[0], [path.join(__dirname, 'test/fixtures/fatal.js')])

  t.is(stdout.toString(), 'host fatal\n')
})

test('teardown callbacks run in reverse order as Bare exits', (t) => {
  const { stdout } = spawnSync(Bare.argv[0], [path.join(__dirname, 'test/fixtures/teardown.js')])

  t.is(stdout.toString(), '3\n1\n')
})

test('a module that is not an addon is rejected', (t) => {
  const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

  t.exception(() => instantiate(empty), /does not export 'memory'/)
})

test('a trap in an allocation poisons the instance', (t) => {
  const rt = new Runtime()

  rt.exports = {
    malloc() {
      throw new wasm.RuntimeError('unreachable')
    }
  }

  rt.openScope()

  t.exception.all(() => rt.call(false, () => rt.malloc(16)), wasm.RuntimeError)
  t.ok(rt.crashed instanceof wasm.RuntimeError)
})

test('a buffer that grows while JavaScript runs stays within its copy', (t) => {
  const rt = new Runtime()

  rt.memory = new wasm.Memory({ initial: 1 })
  rt.exports = { malloc: () => 16 }

  const memory = new Uint8Array(rt.memory.buffer)
  const buffer = new ArrayBuffer(4, { maxByteLength: 8 })
  const view = new Uint8Array(buffer)

  rt.openScope()
  rt.stage(view)
  memory.fill(0xaa, 20, 24)

  rt.around(() => {
    buffer.resize(8)
    view.fill(1)
  }, [])

  t.alike(memory.subarray(16, 24), new Uint8Array([1, 1, 1, 1, 0xaa, 0xaa, 0xaa, 0xaa]))
})

test('an unterminated string from the guest is rejected rather than scanned forever', (t) => {
  const rt = new Runtime()

  rt.memory = new wasm.Memory({ initial: 1 })
  new Uint8Array(rt.memory.buffer).fill(0x41)

  t.exception.all(() => rt.read.utf8(65536 - 4, rt.NUL_TERMINATED), /not NUL terminated/)
  t.exception.all(() => rt.read.utf8(65536 - 4, 8), /out of bounds/)
})
