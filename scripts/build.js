const fs = require('fs')
const path = require('path')
const spawn = require('cmake-runtime/spawn')
const ninja = require('ninja-runtime')()
const toolchains = require('cmake-toolchains')

const root = path.resolve(__dirname, '..')

const build = (exports.build = path.join(root, 'build'))

exports.configure = function configure() {
  try {
    fs.accessSync(ninja, fs.constants.X_OK)
  } catch {
    fs.chmodSync(ninja, 0o755)
  }

  return cmake([
    '-S',
    root,
    '-B',
    build,
    '-G',
    'Ninja',
    '--toolchain',
    toolchains['wasi-wasm32'],
    `-DCMAKE_MAKE_PROGRAM=${ninja}`,
    '-DCMAKE_BUILD_TYPE=Release'
  ])
}

exports.compile = function compile() {
  return cmake(['--build', build])
}

exports.headers = function headers() {
  return JSON.parse(fs.readFileSync(path.join(build, 'headers.json')))
}

function cmake(args) {
  const job = spawn('cmake', { args })

  let output = ''

  job.stdout.on('data', (data) => (output += data))
  job.stderr.on('data', (data) => (output += data))

  return new Promise((resolve, reject) => {
    job.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`CMake exited with code ${code}\n${output}`))
    })
  })
}
