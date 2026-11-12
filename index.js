const load = require('./lib/load')

module.exports = function instantiate(bytes, opts = {}) {
  const { rt, exports } = load(bytes, opts)

  return rt.boundary === null ? exports : rt.boundary.toHost(exports)
}
