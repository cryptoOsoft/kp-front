import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Code comments point at the `docs/` page that holds a rule, never at the repo guide for agents:
// that file is a short index whose headings move (39 comments pointed at sections it no longer
// had after #385). Every page and its topic: docs/README.md.
// Both spellings of a cite: the file name, and the bare name followed by «· section». Built from
// parts so this file passes its own check.
const GUIDE = new RegExp(`${'AGENTS'}\\s*[·.]`)
const CODE = /\.(ts|tsx|js|mjs|cjs|css|py|sh)$/
// tracked code folders, plus the config files at the repo root (vite.config.ts, eslint.config.js …)
const ROOTS = ['src', 'backend', 'e2e', 'scripts', 'shared', 'tools']

describe('comment pointers', () => {
  it('no code file names the agents guide – point at the docs/ page instead', () => {
    const ls = (...args) => execFileSync('git', ['ls-files', ...args], { encoding: 'utf-8' }).split('\n')
    const files = [...ls(...ROOTS), ...ls().filter((f) => !f.includes('/'))].filter((f) => CODE.test(f))
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf-8')
        .split('\n')
        .flatMap((line, i) => (GUIDE.test(line) ? [`${f}:${i + 1}`] : [])),
    )
    expect(hits).toEqual([])
  })
})
