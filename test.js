const { test, hook } = require('brittle')
const fs = require('bare-fs')
const path = require('bare-path')
const instantiate = require('.')
const Runtime = require('./lib/runtime')
const { build, configure, compile } = require('./scripts/build')

hook('build the fixtures', { timeout: 10 * 60 * 1000 }, async () => {
  await configure()
  await compile()
})

function load(name) {
  return instantiate(fs.readFileSync(path.join(build, `${name}.wasm`)))
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

  t.exception.all(() => addon.trap(), WebAssembly.RuntimeError)
  t.exception(() => addon.trap(), /WebAssembly addon has crashed/)
  t.is(other.add(1, 2), 3, 'other instances keep working')
})

test('a module that is not an addon is rejected', (t) => {
  const empty = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

  t.exception(() => instantiate(empty), /does not export 'memory'/)
})

test('an unterminated string from the guest is rejected rather than scanned forever', (t) => {
  const rt = new Runtime()

  rt.memory = new WebAssembly.Memory({ initial: 1 })
  new Uint8Array(rt.memory.buffer).fill(0x41)

  t.exception.all(() => rt.read.utf8(65536 - 4, rt.NUL_TERMINATED), /not NUL terminated/)
  t.exception.all(() => rt.read.utf8(65536 - 4, 8), /out of bounds/)
})
