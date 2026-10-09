const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const prettier = require('prettier')
const llvm = require('llvm-runtime')
const resourceDir = require('llvm-runtime/resource-dir')
const sysroot = require('wasi-sysroot')
const { configure, headers } = require('./build')

const root = path.resolve(__dirname, '..')

let typedefs = null

function collectEnums(ast) {
  const result = {}

  for (const node of ast.inner) {
    if (node.kind !== 'EnumDecl' || !node.inner) continue

    let next = 0

    for (const constant of node.inner) {
      if (constant.kind !== 'EnumConstantDecl') continue

      const value = evaluate(constant.inner && constant.inner[0])

      next = value === null ? next : value
      result[constant.name] = next++
    }
  }

  return result
}

function evaluate(node) {
  if (!node) return null

  if (node.kind === 'ConstantExpr' && node.value !== undefined) return Number(node.value)

  if (node.inner) return evaluate(node.inner[0])

  return null
}

function collectTypedefs(ast) {
  const result = new Map()

  for (const node of ast.inner) {
    if (node.kind !== 'TypedefDecl') continue

    result.set(node.name, node.type.desugaredQualType || node.type.qualType)
  }

  return result
}

function collectLayouts(dump) {
  const result = {}

  for (const block of dump.split('*** Dumping AST Record Layout')) {
    const lines = block.split('\n').filter((line) => line.includes('|'))
    if (lines.length === 0) continue

    const name = lines[0].match(/\|\s+struct (js_\w+)_s$/)
    if (!name) continue

    const fields = {}
    let size = 0

    for (const line of lines.slice(1)) {
      const field = line.match(/^\s*(\d+) \|   [^|]*?(\w+)$/)
      const total = line.match(/\[sizeof=(\d+)/)

      if (total) size = Number(total[1])
      else if (field) fields[field[2]] = Number(field[1])
    }

    result[name[1] + '_t'] = { size, fields }
  }

  return result
}

function collectFunctions(ast) {
  const result = []

  for (const node of ast.inner) {
    if (node.kind !== 'FunctionDecl' || !node.name.startsWith('js_')) continue

    const inner = node.inner || []

    const params = inner
      .filter((child) => child.kind === 'ParmVarDecl')
      .map((param) => ({
        name: param.name,
        type: param.type.qualType,
        canonical: param.type.desugaredQualType || param.type.qualType
      }))

    if (node.variadic) params.push({ name: 'varargs', type: '...', canonical: '...' })

    const comment = textOf(inner.find((child) => child.kind === 'FullComment'))

    const fn = {
      name: node.name,
      params,
      allowsPendingException: /can be called even if there is a pending JavaScript exception/.test(
        comment
      )
    }

    for (const param of params) param.kind = classify(fn, param)

    result.push(fn)
  }

  return result
}

function textOf(node) {
  if (!node) return ''
  if (node.kind === 'TextComment') return node.text
  return (node.inner || []).map(textOf).join(' ').replace(/\s+/g, ' ')
}

// Parameters whose shape the type alone does not reveal, such as an output
// array that decays to the same type as a single output handle.
const overrides = {
  js_get_callback_info: { argc: 'pointer', argv: 'pointer' },
  js_get_array_elements: { elements: 'pointer' },
  js_get_value_bigint_words: { words: 'pointer' },
  js_get_heap_space_statistics: { statistics: 'pointer' }
}

const scalars = {
  bool: 'bool',
  int: 'i32',
  int32_t: 'i32',
  uint32_t: 'u32',
  int64_t: 'i64',
  uint64_t: 'u64',
  size_t: 'u32',
  double: 'f64'
}

const strings = {
  'const char *': 'utf8',
  'const utf8_t *': 'utf8',
  'const utf16_t *': 'utf16le',
  'const latin1_t *': 'latin1'
}

function classify(fn, param) {
  const override = overrides[fn.name] && overrides[fn.name][param.name]
  if (override) return override

  const { type, canonical } = param

  if (type === '...') return 'varargs'
  if (type === 'va_list') return 'varargs'
  if (type === 'js_env_t *') return 'env'
  if (type === 'js_value_t *') return 'value'
  if (type === 'js_ref_t *') return 'ref'
  if (type === 'js_value_t *const *') return 'values'
  if (type in strings) return 'string'
  if (canonical.includes('(*)')) return 'callback'

  const scalar = scalarOf(type)
  if (scalar) return scalar

  const pointee = pointeeOf(type)

  if (pointee !== null) {
    if (pointee === 'js_value_t *') return 'out-value'
    if (pointee.endsWith('*')) return 'out-u32'

    const scalar = type.startsWith('const ') ? null : scalarOf(pointee)
    if (scalar) return 'out-' + scalar
  }

  return 'pointer'
}

function scalarOf(type) {
  if (type in scalars) return scalars[type]

  const resolved = typedefs.get(type)
  if (resolved && resolved.startsWith('enum ')) return 'i32'

  return null
}

function pointeeOf(type) {
  return type.endsWith('*') ? type.slice(0, -1).trimEnd() : null
}

function countFor(fn, param) {
  const candidates = [
    `${param.name}_len`,
    `${param.name}_count`,
    'argc',
    'len',
    'property_count',
    'element_count'
  ]

  for (const name of candidates) {
    const count = fn.params.find((p) => p.name === name && p.kind === 'u32')
    if (count) return count.name
  }

  throw new Error(`No length parameter for ${fn.name}(${param.name})`)
}

function lengthFor(fn, param) {
  const next = fn.params[fn.params.indexOf(param) + 1]

  return next && next.kind === 'u32' && /(^|_)len$/.test(next.name) ? next.name : null
}

function emitBindings(functions) {
  let code = '// Generated by scripts/generate.js from js.h. Do not edit.\n\n'
  code += 'module.exports = function bindings(rt, js) {\n'
  code += '  return {\n'

  code += functions.map((fn) => emitBinding(fn)).join(',\n\n')

  code += '\n  }\n}\n'

  return code
}

function emitBinding(fn) {
  const name = fn.name.slice(3)
  const params = fn.params.map((p) => ident(p.name))
  const outs = fn.params.filter((p) => p.kind.startsWith('out-'))

  const args = ['rt']

  for (const param of fn.params) {
    const id = ident(param.name)

    switch (param.kind) {
      case 'env':
        break
      case 'value':
        args.push(`rt.value(${id})`)
        break
      case 'ref':
        args.push(`rt.ref(${id})`)
        break
      case 'values':
        args.push(`rt.values(${id}, ${ident(countFor(fn, param))} >>> 0)`)
        break
      case 'string': {
        const length = lengthFor(fn, param)
        args.push(
          `rt.read.${strings[param.type]}(${id}, ${length ? ident(length) + ' >>> 0' : 'rt.NUL_TERMINATED'})`
        )
        break
      }
      case 'bool':
        args.push(`${id} !== 0`)
        break
      case 'u64':
        args.push(`BigInt.asUintN(64, ${id})`)
        break
      case 'u32':
      case 'pointer':
      case 'callback':
      case 'varargs':
        args.push(`${id} >>> 0`)
        break
      default:
        if (!param.kind.startsWith('out-')) args.push(id)
    }
  }

  if (outs.length > 0) {
    args.push(`{ ${outs.map((p) => `${p.name}: ${ident(p.name)} !== 0`).join(', ')} }`)
  }

  const call = `js.${name}(${args.join(', ')})`

  let body

  if (outs.length === 0) {
    body = `${call}`
  } else if (outs.length === 1) {
    const [out] = outs
    body = `const value = ${call}\n        if (${ident(out.name)} !== 0) rt.write.${out.kind.slice(4)}(${ident(out.name)}, value)`
  } else {
    body = `const values = ${call}`
    for (const out of outs) {
      body += `\n        if (${ident(out.name)} !== 0) rt.write.${out.kind.slice(4)}(${ident(out.name)}, values.${out.name})`
    }
  }

  return (
    `    ${fn.name}(${params.join(', ')}) {\n` +
    `      return rt.call(${fn.allowsPendingException}, () => {\n` +
    `        ${body}\n` +
    '      })\n' +
    '    }'
  )
}

const taken = new Set([
  'function',
  'default',
  'delete',
  'new',
  'class',
  'this',
  'arguments',
  'eval',
  'value',
  'values'
])

function ident(name) {
  return taken.has(name) ? name + '_' : name
}

function emitConstants(enums, layouts) {
  return (
    '// Generated by scripts/generate.js from js.h for wasm32. Do not edit.\n\n' +
    `exports.enums = ${JSON.stringify(enums, null, 2)}\n\n` +
    `exports.layouts = ${JSON.stringify(layouts, null, 2)}\n`
  )
}

function emitSymbols(functions, js) {
  return (
    functions
      .filter((fn) => typeof js[fn.name.slice(3)] === 'function')
      .map((fn) => fn.name)
      .join('\n') + '\n'
  )
}

function summarize(functions, js) {
  const missing = []
  let implemented = 0
  let excluded = 0

  for (const fn of functions) {
    const name = fn.name.slice(3)

    if (typeof js[name] === 'function') implemented++
    else if (name in js.excluded) excluded++
    else missing.push(fn.name)
  }

  let summary = `${functions.length} functions: ${implemented} implemented, ${excluded} excluded, ${missing.length} not yet implemented`

  for (const name of missing) summary += `\n- ${name}`

  return summary
}

async function write(file, code) {
  const options = await prettier.resolveConfig(file)

  fs.writeFileSync(file, await prettier.format(code, { ...options, filepath: file }))
}

async function main() {
  await configure()

  const include = headers()

  const args = [
    '--target=wasm32-wasip1',
    `--sysroot=${sysroot('wasm32-wasip1')}`,
    `-resource-dir=${resourceDir()}`,
    ...include.flatMap((directory) => ['-I', directory]),
    '-x',
    'c',
    '-fsyntax-only',
    path.join(include[0], 'js.h')
  ]

  const clang = llvm('clang')

  const ast = JSON.parse(
    execFileSync(clang, [...args, '-Xclang', '-ast-dump=json'], { maxBuffer: 1 << 30 })
  )

  const layoutDump = execFileSync(clang, [...args, '-Xclang', '-fdump-record-layouts-complete'], {
    maxBuffer: 1 << 30
  }).toString()

  const enums = collectEnums(ast)
  typedefs = collectTypedefs(ast)
  const layouts = collectLayouts(layoutDump)
  const functions = collectFunctions(ast)

  const lib = path.join(root, 'lib')

  await write(path.join(lib, 'constants.js'), emitConstants(enums, layouts))
  await write(path.join(lib, 'abi.js'), emitBindings(functions))

  const js = require(path.join(lib, 'js'))

  fs.writeFileSync(path.join(root, 'wasm.syms'), emitSymbols(functions, js))

  console.log(summarize(functions, js))
}

main()
