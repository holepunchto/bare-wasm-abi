const fs = require('bare-fs')
const path = require('bare-path')
const instantiate = require('../..')

const addon = instantiate(fs.readFileSync(path.join(__dirname, '../../build/teardown.wasm')), {
  wasi: { version: 'preview1', stdout: (data) => fs.writeSync(1, data) }
})

addon.addTeardown(1)
addon.addTeardown(2)
addon.addTeardown(3)
addon.removeTeardown(2)
