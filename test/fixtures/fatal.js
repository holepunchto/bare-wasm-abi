const fs = require('bare-fs')
const path = require('bare-path')
const Realm = require('bare-realm')
const instantiate = require('../..')

const realm = new Realm()

const addon = instantiate(fs.readFileSync(path.join(__dirname, '../../build/realm.wasm')), {
  realm
})

Bare.on('uncaughtException', (err) => {
  console.log(Realm.isFrom(err, realm.evaluate('globalThis')) ? 'realm' : 'host', err.message)
})

addon.fatal("new Error('fatal')")
