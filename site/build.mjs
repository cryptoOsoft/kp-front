#!/usr/bin/env node
/**
 * Builds the landing page from one template plus one text file per language.
 *
 *   site/index.template.html   ← structure, markup, images, scripts
 *   site/content/config.json   ← which languages exist, and under which URL
 *   site/content/de.json       ← the German text (the base)
 *   site/content/fr.json       ← the translation, laid over the base
 *
 *   node site/build.mjs            → asks GitHub for the latest release, writes the pages
 *   node site/build.mjs --offline  → the same from the stored release, without asking GitHub
 *   node site/build.mjs --check    → writes nothing, reports drift only (CI, never online)
 *
 * Two kinds of page come out:
 *
 *   site/index.html          site/fr/index.html        ← what Pages serves
 *   site/dist/index.html     site/dist/fr/index.html   ← the same page as ONE file
 *
 * The first kind is committed, because GitHub Pages serves `site/` verbatim –
 * the page in the repo IS the page on the web. So whoever edits the template or
 * a text has to rebuild, and `--check` in CI makes sure nobody forgets. The
 * second kind is the hand-out variant: fonts and screenshots as data: URIs,
 * readable offline, no server needed.
 *
 * Alongside them the build writes site/404.html, site/sitemap.xml and site/robots.txt,
 * all three from the same config – so a new language never needs a second list – and
 * site/content/release.json, the latest GitHub release as last seen (see below).
 *
 * theme.js is embedded before CSS in every page; picture sources retain both themes
 * in the offline bundle. Keep this builder and theme.js identical in both repositories.
 *
 * A third language is one entry in config.json and one file in content/ – the
 * template does not change. A language ships only once it is listed in
 * config.json: an empty `it/` is worse than none.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHECK = process.argv.includes('--check')
const OFFLINE = CHECK || process.argv.includes('--offline')

const read = (...p) => readFileSync(join(HERE, ...p), 'utf8')
const readJson = (...p) => JSON.parse(read(...p))

const config = readJson('content', 'config.json')

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// ─── Text files: every language sits on top of the base language ──────────────
//
// Same mechanism as the app (src/config/copy/): German is the base, every other
// language overrides only what it has actually translated. A missing key falls
// back to German visibly instead of rendering empty – and the coverage figure
// below makes sure "falls back" never quietly means "forgotten". Lists are
// overlaid entry by entry, so a translation need not repeat file names or order.
const merge = (base, over) => {
  if (over === undefined) return base
  if (Array.isArray(base) && Array.isArray(over))
    return base.map((item, i) => merge(item, over[i])).concat(over.slice(base.length))
  if (isPlainObject(base) && isPlainObject(over)) {
    const out = { ...base }
    for (const key of Object.keys(over)) out[key] = merge(base[key], over[key])
    return out
  }
  return over
}

// Not every leaf is text. A screenshot's file name and pixel size are shared on
// purpose: the images stay German on every language's page (they come from a
// real instance – restaged ones would be a claim), and the page says so instead
// of pretending otherwise. Counting those as gaps would bury the real ones.
const STRUCTURAL = [/^shots\.items\[\d+\]\.(file|w|h)$/, /^hero\.frame(FileSmall|File|W|H)$/]
const translatable = (path) => !STRUCTURAL.some((re) => re.test(path))

const allLeafPaths = (v, path = '', out = []) => {
  if (Array.isArray(v)) v.forEach((x, i) => allLeafPaths(x, `${path}[${i}]`, out))
  else if (isPlainObject(v)) for (const k of Object.keys(v)) allLeafPaths(v[k], path ? `${path}.${k}` : k, out)
  else out.push(path)
  return out
}

// Which leaves a language did NOT translate – reported as a coverage figure.
const untranslated = (base, over, path = '', out = []) => {
  if (over === undefined) { out.push(path); return out }
  if (Array.isArray(base) && Array.isArray(over))
    base.forEach((item, i) => untranslated(item, over[i], `${path}[${i}]`, out))
  else if (isPlainObject(base) && isPlainObject(over))
    for (const key of Object.keys(base)) untranslated(base[key], over[key], path ? `${path}.${key}` : key, out)
  return out
}

// ─── The template language ────────────────────────────────────────────────────
//
// Three forms, which is all this page needs:
//
//   {{path.to.text}}          inserts text (markup inside the text is allowed
//                             and wanted – <strong> and <a> belong to the sentence)
//   {{.}}                     the entry itself, inside a list of plain strings
//   {{#path}} … {{/path}}     list  → the block once per entry ({{field}} resolves
//                                     against the entry, then against the root)
//                             truthy value → the block once, or not at all
//
// A section tag alone on its line takes that whole line with it, so a repeated
// block keeps the indentation of its own body instead of collecting blank lines.
//
// No escaping: the content comes from this repo, not from visitors.
const STANDALONE = /^[ \t]*(\{\{[#/][\w.]+\}\})[ \t]*\r?\n/gm
const SECTION = /\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g
const VALUE = /\{\{(\.|\w+(?:\.\w+)*)\}\}/g

// Notes addressed to whoever edits the template have no business on the page.
const TEMPLATE_ONLY = /^[ \t]*<!--@template[\s\S]*?-->[ \t]*\r?\n/gm

const lookup = (scopes, path) => {
  if (path === '.') return scopes[scopes.length - 1]
  for (let i = scopes.length - 1; i >= 0; i--) {
    let cur = scopes[i]
    let found = true
    for (const key of path.split('.')) {
      if (!isPlainObject(cur) && !Array.isArray(cur)) { found = false; break }
      if (!(key in cur)) { found = false; break }
      cur = cur[key]
    }
    if (found) return cur
  }
  return undefined
}

const render = (tpl, scopes, missing) =>
  tpl
    .replace(SECTION, (_, path, body) => {
      const val = lookup(scopes, path)
      if (Array.isArray(val)) return val.map((item) => render(body, [...scopes, item], missing)).join('')
      if (!val) return ''
      return render(body, isPlainObject(val) ? [...scopes, val] : scopes, missing)
    })
    .replace(VALUE, (_, path) => {
      const val = lookup(scopes, path)
      if (val === undefined || val === null) { missing.add(path); return '' }
      return String(val)
    })

// A text as structured data reads it: the markup stripped, the two entities the texts use
// decoded, line breaks collapsed. A <script> body is raw text, so `&nbsp;` would otherwise
// reach the crawler literally – which is why any other entity stops the build.
const plainText = (html) => {
  // Strip until stable, so a tag split by another tag (`<scr<b>ipt>`) can't reassemble.
  let stripped = html
  for (let prev; prev !== stripped; ) {
    prev = stripped
    stripped = stripped.replace(/<[^>]*>/g, '')
  }
  const text = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  if (/&#?\w+;/.test(text)) throw new Error(`Undecoded entity in structured data: ${text}`)
  return text
}

const template = read('index.template.html')
  .replace(TEMPLATE_ONLY, '')
  .replace(STANDALONE, '$1')

const BANNER = (locale) =>
  `<!-- Built from site/index.template.html + site/content/${locale}.json.\n` +
  `     Edits here are lost on the next \`node site/build.mjs\`. -->`

// ─── The single-file variant ──────────────────────────────────────────────────
const MIME = {
  woff2: 'font/woff2',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
  svg: 'image/svg+xml',
}

// A sub-language page points back at site/ with ../; embedding always resolves
// against site/, no matter which depth the reference was written at.
const flatten = (rel) => rel.replace(/^(\.\.\/)+/, '')

const inline = (rel, seen) => {
  const flat = flatten(rel)
  const mime = MIME[flat.split('.').pop().toLowerCase()]
  if (!mime) throw new Error(`No MIME type registered for ${flat}`)
  seen.push(flat)
  return `data:${mime};base64,${readFileSync(join(HERE, flat)).toString('base64')}`
}

const bundle = (html) => {
  const seen = []
  // The served pages link `fr/` and `../`, which is what keeps the public URLs clean. A
  // browser only resolves those to index.html over HTTP, though – and the whole point of
  // this variant is that it opens from a file:// path with no server, where `fr/` lands on a
  // directory instead of a page. So the hand-out, and only the hand-out, spells the file out.
  html = html.replace(/<a\b[^>]*\bdata-language-link\b[^>]*>/g, (link) =>
    link.replace(/href="([^"]*)"/, 'href="$1index.html"'),
  )
  // Zwei Verweise, die in der Einzeldatei nichts mehr zu suchen haben: der Preload zeigt auf
  // eine Schriftdatei, die hier im Stylesheet mitreist, und srcset/sizes auf eine zweite
  // Fassung desselben Bildes. Die Einzeldatei bettet je ein Bild ein und zeigt es in jeder
  // Breite – beides bliebe sonst als Pfad auf eine Datei stehen, die es hier nicht gibt.
  html = html
    .replace(/^[ \t]*<link rel="preload"[^>]*>\r?\n/gm, '')
    .replace(/<img\b[^>]*>/g, (img) => img.replace(/\s+srcset="[^"]*"/g, ''))
    .replace(/\s+sizes="[^"]*"/g, '')
  // Stylesheet first, so the font URLs inside it come along in the same pass.
  let out = html.replace(/<link rel="stylesheet" href="((?:\.\.\/)*[^"]+)">/g, (_, rel) => {
    const flat = flatten(rel)
    seen.push(flat)
    return `<style>\n${read(flat)}</style>`
  })
  out = out.replace(/url\(((?:\.\.\/)*fonts\/[^)'"]+)\)/g, (_, rel) => `url(${inline(rel, seen)})`)
  // A picture's dark source must survive bundling. Keep its full-size image, without
  // a width descriptor: the offline hand-out embeds one image per theme.
  out = out.replace(/(<source\b[^>]*\bsrcset=")([^"]+)(")/g, (_, start, set, end) => {
    const full = set.split(',').pop().trim().split(/\s+/)[0]
    return `${start}${inline(full, seen)}${end}`
  })
  out = out.replace(/src="((?:\.\.\/)*(?:shots|fonts)\/[^"]+)"/g, (_, rel) => `src="${inline(rel, seen)}"`)

  if (out.match(/(?:src=|srcset=|href=|url\()["']?(?:\.\.\/|\.\/)*(?:fonts|shots)\//))
    throw new Error('Local references survived the bundle – adjust build.mjs')
  return out
}

// ─── Dates ────────────────────────────────────────────────────────────────────
//
// A calendar date as YYYY-MM-DD, taken in Zurich – where the project and its releases live – so
// a release published at 00:30 is not dated the day before. The texts choose how a date is
// shown (`footer.release.dateFormat`, e.g. DD.MM.YYYY), because no locale database agrees
// with the Swiss convention for all five languages.
const zurichDate = (date) => date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })
const showDate = (iso, format) => {
  const [y, m, d] = iso.split('-')
  return format.replace('DD', d).replace('MM', m).replace('YYYY', y)
}

// ─── The latest release ───────────────────────────────────────────────────────
//
// The footer line and the app's softwareVersion, dateModified and releaseNotes name the latest
// GitHub release. A plain build asks GitHub and stores the answer in content/release.json;
// `--offline` and `--check` only read that file, so CI never depends on the network and judges
// the committed pages against the committed release. When GitHub cannot be reached or answers
// with something unusable, the stored release stands – never an empty or half-filled line.
// Without a stored release the line and the three properties are left out altogether.
//
// GitHub Pages serves the committed pages, so a new release reaches the site with the next
// rebuild that is committed – run `node site/build.mjs` after publishing one.
const RELEASE_FILE = join('content', 'release.json')

const fetchRelease = async () => {
  const [, owner, repo] = new URL(config.product.repo).pathname.split('/')
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': `${repo}-site-build` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const { tag_name: tag, published_at: published, html_url: url } = await res.json()
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '') || !url?.startsWith(`${config.product.repo}/releases/`) || !Date.parse(published))
    throw new Error(`unusable answer for ${tag}`)
  return { tag, date: zurichDate(new Date(published)), url }
}

const storedRelease = existsSync(join(HERE, RELEASE_FILE)) ? readJson(RELEASE_FILE) : null
let release = storedRelease
if (!OFFLINE) {
  try {
    release = await fetchRelease()
  } catch (err) {
    console.warn(`Latest release not fetched (${err.message}) – keeping ${storedRelease?.tag ?? 'no release line'}.`)
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────
const baseLocale = config.locales[0]
const base = readJson('content', `${baseLocale.code}.json`)

const dirOf = (locale) => locale.dir ?? (locale.code === baseLocale.code ? '' : `${locale.code}/`)
const urlOf = (locale) => `${config.origin}/${dirOf(locale)}`

const written = []
const stale = []
const problems = []

/**
 * ⚠️ `--check` only judges the COMMITTED pages.
 *
 * `site/dist/` is gitignored – it is the hand-out variant, rebuilt on demand and never in the
 * repo. So on a fresh CI checkout those two files do not exist, `--check` found them missing and
 * reported the built pages as «behind» on every single push. The check was unsatisfiable by
 * construction, and a gate that can only ever be red teaches people to ignore a red gate.
 *
 * The reason `--check` exists is that GitHub Pages serves `site/` verbatim: the page in the repo
 * IS the page on the web, so it must not drift from its sources. Nothing about that applies to a
 * file which is not in the repo.
 */
const isCommitted = (rel) => !rel.startsWith('dist/') && !rel.startsWith(join('dist', ''))

const put = (rel, content) => {
  const path = join(HERE, rel)
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (current === content) return
  if (CHECK) { if (isCommitted(rel)) stale.push(rel); return }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  written.push(rel)
}

if (release) put(RELEASE_FILE, `${JSON.stringify(release, null, 2)}\n`)

// The day a language page last changed, read back from its committed copy. It cannot come from
// git: the page is committed together with the change that alters it, so its own commit date
// is unknown while it is being built.
const previousModified = (html, webPageId) => {
  const ld = html?.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/)
  return ld ? JSON.parse(ld[1])['@graph']?.find((node) => node['@id'] === webPageId)?.dateModified : undefined
}
const today = zurichDate(new Date())

for (const locale of config.locales) {
  const isBase = locale.code === baseLocale.code
  const own = isBase ? base : readJson('content', `${locale.code}.json`)
  const content = isBase ? base : merge(base, own)
  const dir = dirOf(locale)
  const up = '../'.repeat(dir.split('/').filter(Boolean).length)

  // The switcher is RELATIVE, the metadata is ABSOLUTE, and the split is deliberate.
  // `canonical` and `hreflang` name one authoritative address, so they have to carry the
  // origin. The visible links must not: an absolute switcher pins the pages to
  // kp-front.ch, and then DE→FR walks off any copy that is not it – a local preview, the
  // single-file dist/ hand-out, a self-hoster's own domain. Relative, the pair travels
  // together wherever the folder goes.
  const relTo = (l) => `${up}${dirOf(l)}` || './'

  // ─── Structured data ────────────────────────────────────────────────────────
  //
  // Every node true and checkable:
  //
  //   SoftwareApplication  what this is – ONE stable @id and the canonical product URL on
  //                        every language page, so the five pages describe one app; version,
  //                        date and release notes of the latest release; the demo as a
  //                        ViewAction
  //   SoftwareSourceCode   where the code lives (`codeRepository` belongs here, not on the
  //                        app), linked from the app via `subjectOf`
  //   CreativeWorkSeries   KP Front and KP Rück as one family – the same @id on both sites,
  //                        so the two apps belong together without claiming to be the same
  //                        thing (hence no `sameAs` between them)
  //   Person               who wrote it: author, creator and copyright holder, the same @id
  //                        on both sites
  //   WebSite              this domain and the languages it is published in
  //   WebPage              this language page, with its own URL, title, language and the
  //                        day it last changed – not the release date, which is the app's
  //   FAQPage              this page's visible FAQ
  //
  // The publisher is Feuerwehr Oberwil, referenced by the @id its own website gives it
  // (`product.publisher`) and deliberately not described here: the full node lives on
  // feuerwehr-oberwil.ch, and a second, slightly different copy on each product domain is
  // exactly the contradiction a single @id is meant to prevent.
  //
  // Two kinds of language, kept apart on purpose: `product.inLanguage` names the languages
  // of the APP's interface, the page's own language goes on WebPage and FAQPage, and the
  // site's five on WebSite. A Romansh landing page is not a Romansh app.
  //
  // Everything per language comes from the texts: `schema.description` and
  // `schema.featureList` (optional – without them the meta description stands in),
  // `schema.audience` and `schema.demoAction`, and the FAQPage is the visible `faq.items`,
  // reduced to plain text – one source, so the two can never say different things. Google
  // has shown FAQ rich results only for government and health sites since 2023; the FAQPage
  // is there for the other search and answer engines that still read it.
  //
  // Built here rather than written into the template because JSON.stringify guarantees valid
  // JSON: the template does not escape, and one apostrophe in a description would silently
  // turn the whole block into something no crawler reads.
  const p = config.product
  const appId = `${config.origin}/#app`
  const siteId = `${config.origin}/#website`
  const webPageId = `${urlOf(locale)}#webpage`
  const publisher = { '@id': p.publisher }
  const author = { '@id': p.author.id }
  const faqItems = content.faq?.items ?? []
  const jsonLd = (modified) => JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'SoftwareApplication',
          '@id': appId,
          name: p.name,
          url: urlOf(baseLocale),
          description: content.schema?.description ?? content.meta.description,
          ...(content.schema?.featureList && { featureList: content.schema.featureList }),
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Web browser',
          inLanguage: p.inLanguage,
          ...(release && { softwareVersion: release.tag.replace(/^v/, ''), dateModified: release.date, releaseNotes: release.url }),
          license: p.license,
          sameAs: p.repo,
          subjectOf: { '@id': `${config.origin}/#source` },
          isPartOf: { '@id': p.suite.id },
          screenshot: `${config.origin}/${p.screenshot}`,
          isAccessibleForFree: true,
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'CHF' },
          ...(content.schema?.audience && {
            audience: content.schema.audience.map((audienceType) => ({ '@type': 'Audience', audienceType })),
          }),
          potentialAction: {
            '@type': 'ViewAction',
            name: content.schema.demoAction,
            target: { '@type': 'EntryPoint', urlTemplate: p.demo },
          },
          author,
          creator: author,
          copyrightHolder: author,
          publisher,
        },
        {
          '@type': 'SoftwareSourceCode',
          '@id': `${config.origin}/#source`,
          name: `${p.name} source code`,
          codeRepository: p.repo,
          license: p.license,
          author,
          publisher,
        },
        {
          '@type': 'CreativeWorkSeries',
          '@id': p.suite.id,
          name: p.suite.name,
          hasPart: p.suite.apps.map((id) => ({ '@id': id })),
          publisher,
        },
        {
          '@type': 'Person',
          '@id': p.author.id,
          name: p.author.name,
          url: p.author.url,
          sameAs: [p.author.github],
        },
        {
          '@type': 'WebSite',
          '@id': siteId,
          url: urlOf(baseLocale),
          name: p.name,
          inLanguage: config.locales.map((l) => l.hreflang),
          publisher,
        },
        {
          '@type': 'WebPage',
          '@id': webPageId,
          url: urlOf(locale),
          name: plainText(content.meta.title),
          description: plainText(content.meta.description),
          inLanguage: locale.hreflang,
          dateModified: modified,
          isPartOf: { '@id': siteId },
          mainEntity: { '@id': appId },
        },
        ...(faqItems.length
          ? [{
              '@type': 'FAQPage',
              '@id': `${urlOf(locale)}#faq`,
              inLanguage: locale.hreflang,
              mainEntity: faqItems.map((item) => ({
                '@type': 'Question',
                name: plainText(item.q),
                acceptedAnswer: { '@type': 'Answer', text: plainText(item.a) },
              })),
            }]
          : []),
      ],
    },
    null,
    2,
  )

  // Everything that is not text but follows from where the page sits: language,
  // path depth, canonical address, and the links to its sister languages.
  const page = {
    ...content,
    lang: locale.code,
    ogLocale: locale.ogLocale,
    ogAlternates: config.locales.filter((l) => l.code !== locale.code).map((l) => l.ogLocale),
    base: up,
    canonical: urlOf(locale),
    latestRelease: release && {
      version: release.tag,
      iso: release.date,
      date: showDate(release.date, content.footer.release.dateFormat),
      url: release.url,
    },
    themeScript: read('theme.js'),
    alternates: config.locales
      .map((l) => ({ hreflang: l.hreflang, href: urlOf(l) }))
      .concat([{ hreflang: 'x-default', href: urlOf(baseLocale) }]),
    langLinks: config.locales.map((l) => ({
      code: l.code,
      label: l.label,
      name: l.name,
      href: relTo(l),
      current: l.code === locale.code,
    })),
  }

  // The page is rendered with the date it already carries; only if that changes anything is it
  // rendered again with today's. So a rebuild that alters nothing keeps the old date, and
  // `--check` compares like with like.
  const missing = new Set()
  const htmlFor = (modified) =>
    render(template, [{ ...page, jsonLd: jsonLd(modified) }], missing)
      .replace(/^<!doctype html>/i, `<!doctype html>\n${BANNER(locale.code)}`)
  const rel = `${dir}index.html`
  const committed = existsSync(join(HERE, rel)) ? read(rel) : null
  const kept = previousModified(committed, webPageId)
  let html = htmlFor(kept ?? today)
  if (!CHECK && html !== committed) html = htmlFor(today)
  if (missing.size) problems.push(`${locale.code}: ${[...missing].join(', ')}`)

  put(rel, html)
  put(join('dist', dir, 'index.html'), bundle(html))

  if (!isBase) {
    // A screenshot's file name and pixel size are shared on purpose, not
    // translated – the images are German on every language's page, and the page
    // says so rather than pretending otherwise. Counting them as gaps would bury
    // the ones that matter.
    const gaps = untranslated(base, own).filter(translatable)
    const total = allLeafPaths(base).filter(translatable).length
    console.log(`${locale.code}: ${total - gaps.length}/${total} texts translated (${(((total - gaps.length) / total) * 100).toFixed(1)} %)`)
    if (gaps.length) {
      console.log(`   ${gaps.length} fall back to ${baseLocale.code}:`)
      gaps.forEach((p) => console.log(`     · ${p}`))
    }
  }
}

// ─── 404 ──────────────────────────────────────────────────────────────────────
//
// ONE file for every unmatched address. GitHub Pages serves `/404.html` for /tippfehler and
// for /fr/vieux-lien alike, so — unlike every page above — this one cannot be built per
// language and put in a folder: it has to carry all of them and pick at display time. Every
// language's block is rendered into it; the template's script reveals the one that matches the
// first path segment and leaves the base language standing when nothing does.
//
// Without it GitHub serves its own «Page not found · GitHub Pages» — grey, GitHub-branded, and
// with no way back to kp-front.ch.
{
  const notFoundTpl = read('404.template.html').replace(TEMPLATE_ONLY, '').replace(STANDALONE, '$1')
  const missing = new Set()
  const pages = config.locales.map((locale) => {
    const isBase = locale.code === baseLocale.code
    const content = isBase ? base : merge(base, readJson('content', `${locale.code}.json`))
    return {
      ...content,
      lang: locale.code,
      // absolute, because this page is displayed at an address that is not its own
      home: `/${dirOf(locale)}`,
      hidden: !isBase,
    }
  })
  const html = render(notFoundTpl, [{
    pages,
    baseLang: baseLocale.code,
    baseTitle: base.notFound.pageTitle,
    themeScript: read('theme.js'),
  }], missing)
    .replace(/^<!doctype html>/i, `<!doctype html>\n${BANNER(`${baseLocale.code} (+ ${config.locales.length - 1} more)`)}`)
  if (missing.size) problems.push(`404: ${[...missing].join(', ')}`)
  put('404.html', html)
  // No dist/ variant: the single-file hand-out has no server to 404 with.
}

// ─── robots.txt and sitemap.xml ───────────────────────────────────────────────
//
// Both are built from the same config as the pages, so a fifth language shows up in the
// sitemap by adding it to config.json – nobody has to remember a second list.
//
// The sitemap names every language version once and repeats the full hreflang set inside each
// entry, which is what the format asks for: the <link> tags in the pages and these xhtml:link
// tags say the same thing twice, on purpose, because crawlers read one or the other.
//
// No <lastmod>: it would have to come from git, and a date that is wrong is worse for a
// crawler than no date at all. No <priority>/<changefreq> either – Google ignores both.
{
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const links = config.locales
    .map((l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${xml(urlOf(l))}"/>`)
    .concat([`    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(urlOf(baseLocale))}"/>`])
    .join('\n')

  put(
    'sitemap.xml',
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
      '        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
      config.locales
        .map((l) => `  <url>\n    <loc>${xml(urlOf(l))}</loc>\n${links}\n  </url>\n`)
        .join('') +
      '</urlset>\n',
  )

  put('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.origin}/sitemap.xml\n`)
}

if (problems.length) {
  console.error('Unknown keys in the template:')
  problems.forEach((p) => console.error(`  · ${p}`))
  process.exit(1)
}

if (CHECK) {
  if (stale.length) {
    console.error('The built pages are behind the template and the texts:')
    stale.forEach((f) => console.error(`  · site/${f}`))
    console.error('\n  node site/build.mjs   – and commit the result.')
    process.exit(1)
  }
  console.log('Built pages are up to date.')
} else if (written.length) {
  console.log(`${written.length} files written:`)
  written.forEach((f) => console.log(`  · site/${f}`))
} else {
  console.log('Nothing to do – everything was already up to date.')
}
