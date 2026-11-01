#!/usr/bin/env node
// Turn a minified production stack into source positions with the build's hidden sourcemaps.
// How and when to use it: docs/SOURCEMAPS.md.
//
//   node scripts/symbolicate.mjs <maps> [stack-file]      (stack on stdin when no file is given)
//
// <maps> is either a directory holding the build's maps (a local `dist/assets` built from the
// same commit) or the origin that served the build (`https://front.fwo.li` — the maps are served
// beside the chunks under /assets/ for as long as that build is deployed).
//
// The stack may be pasted straight from a `kpfront.clienterror` log line: the « ⏎ » the server
// writes for a newline is understood. No dependencies — the VLQ decoder below is the whole of
// what a v3 sourcemap needs for a position lookup.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [source, stackFile] = process.argv.slice(2)
if (!source) {
  console.error('usage: node scripts/symbolicate.mjs <maps-dir | https://origin> [stack-file]')
  process.exit(2)
}
const stack = readFileSync(stackFile ?? 0, 'utf-8').replaceAll(' ⏎ ', '\n')

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodeVlq(segment) {
  const out = []
  let value = 0
  let shift = 0
  for (const ch of segment) {
    const digit = B64.indexOf(ch)
    value += (digit & 31) << shift
    if (digit & 32) { shift += 5; continue }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0
    shift = 0
  }
  return out
}

/** generated line (0-based) → segments [genCol, srcIdx, srcLine, srcCol, nameIdx?], absolute */
function parseMappings(mappings) {
  const lines = []
  let src = 0, srcLine = 0, srcCol = 0, name = 0
  for (const line of mappings.split(';')) {
    let genCol = 0
    const segs = []
    for (const raw of line.split(',')) {
      if (!raw) continue
      const f = decodeVlq(raw)
      genCol += f[0]
      if (f.length >= 4) {
        src += f[1]; srcLine += f[2]; srcCol += f[3]
        if (f.length >= 5) name += f[4]
        segs.push([genCol, src, srcLine, srcCol, f.length >= 5 ? name : -1])
      }
    }
    lines.push(segs)
  }
  return lines
}

const cache = new Map()
async function loadMap(file) {
  if (cache.has(file)) return cache.get(file)
  let json = null
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(`${source.replace(/\/$/, '')}/assets/${file}.map`)
    if (res.ok) json = await res.json()
  } else if (existsSync(join(source, `${file}.map`))) {
    json = JSON.parse(readFileSync(join(source, `${file}.map`), 'utf-8'))
  } else {
    // A build from before 01.11.2026 baked its build time into the bundle, so a REBUILD of the
    // same commit names its chunks differently (the build stamp lives in index.html since,
    // vite.config.ts · buildStampMeta) — but that string had a fixed length, so every position
    // is the same. Match the chunk by its name without the hash: `index-CsmMbkFb.js` ↔
    // `index-DcTipmoD.js`.
    const stem = file.replace(/-[\w-]{8}\.m?js$/, '-')
    const twins = readdirSync(source).filter((f) => f.startsWith(stem) && /^[\w-]{8}\.m?js\.map$/.test(f.slice(stem.length)))
    if (twins.length === 1) {
      console.error(`(${file}: using the rebuilt ${twins[0]})`)
      json = JSON.parse(readFileSync(join(source, twins[0]), 'utf-8'))
    }
  }
  const parsed = json ? { json, lines: parseMappings(json.mappings) } : null
  cache.set(file, parsed)
  return parsed
}

function lookup(map, line, col) {
  const segs = map.lines[line - 1]
  if (!segs?.length) return null
  let best = null
  for (const s of segs) { if (s[0] <= col - 1) best = s; else break }
  if (!best) return null
  const [, src, srcLine, srcCol, name] = best
  return `${map.json.sources[src]}:${srcLine + 1}:${srcCol + 1}${name >= 0 ? ` (${map.json.names[name]})` : ''}`
}

const FRAME = /([\w.-]+\.m?js):(\d+):(\d+)/g
for (const line of stack.split('\n')) {
  let out = line
  for (const m of line.matchAll(FRAME)) {
    const map = await loadMap(m[1])
    const hit = map && lookup(map, Number(m[2]), Number(m[3]))
    out += hit ? `   →  ${hit}` : `   →  (no map for ${m[1]})`
  }
  console.log(out)
}
