# site/ – the public landing page (kp-front.ch)

Static page, no framework – but **generated** since the second language arrived:

```
site/
  index.template.html   ← structure and markup (the text does NOT live here)
  content/config.json   ← which languages exist, and under which URL
  content/de.json       ← the German text – the foundation
  content/fr|it|rm|en.json ← the translations, layered over de.json
  landing.css           ← the shared design of KP Front and KP Rück
  fonts/                ← Sora + Spline Sans Mono (variable, self-hosted, no CDN)
  shots/                ← screenshots from a real instance (generated, WebP)
  capture.mjs           ← re-captures shots/
  build.mjs             ← builds the pages from template + texts

  index.html            ← built, checked in, what gets served
  fr|it|rm|en/index.html ← ditto
  dist/…/index.html     ← everything embedded, not checked in
```

## Building

```bash
node site/build.mjs            # asks GitHub for the latest release, writes index.html, the fr/ it/ rm/ en/ pages and dist/
node site/build.mjs --offline  # the same from content/release.json, without asking GitHub
node site/build.mjs --check    # writes nothing, only reports drift (this is what CI does – offline)
```

**After publishing a release, rebuild and commit.** The footer line («Aktuelle Version v… · date ·
Release Notes») and the app's `softwareVersion`, `dateModified` and `releaseNotes` come from the
latest GitHub release, stored in `content/release.json`. If GitHub cannot be reached, the stored
release stays; without one, the line and the three properties are left out – never empty.
Each page's `WebPage.dateModified` is the day that language page last changed: a rebuild that
changes nothing keeps it.

⚠️ **`index.html` and the `fr/` `it/` `rm/` `en/` pages are outputs, not sources.** Whoever writes into them
loses it on the next build. They are checked in anyway: GitHub Pages serves `site/` as-is,
so the page in the repo **is** the page on the web. To keep the two from drifting apart,
CI (`node site/build.mjs --check`) verifies on every push that the built pages match the
state of template and texts.

## Languages

German is the foundation, every further language **overlays** it – the same mechanism as in
the app (`src/config/copy/`). A translation only writes what it translates; everything else
visibly falls back to German, and `build.mjs` reports after every run how many texts that is.

Five languages ship today: `de` (the base), `fr`, `it`, `rm` (Rumantsch Grischun) and `en`. Another language is **one
entry in `content/config.json` and one file in `content/`** – the template does not change.
The reverse holds too: **a language only ships once it is listed in `config.json`.** A
half-translated page is worse than none at all.

Decided deliberately, not accidental:

- **Language choices are text links**, without flags, cookies or redirects. Compact headers
  collect them with appearance in one menu; real links stay crawlable and keep the language in
  a shared URL.
- **No redirect based on `Accept-Language`.** A German-speaking firefighter whose browser
  setting sends them to `/fr/` is worse than a switcher they can see.
- **The screenshots stay German, on every language version.** They come from a real
  instance; staged images would be a claim. The other language pages say so in one line.
- **The app's languages are stated in exactly two places, apart from the website's:** the FAQ
  «In welchen Sprachen ist KP Front verfügbar?» (German only today) and `product.inLanguage`
  (`config.json`, → `SoftwareApplication.inLanguage`). Whoever ships another app language
  updates both, in all five texts. The website's languages go on `WebSite`/`WebPage`.
- **A translation that no fire-service person of that language has read says so at the top
  of the page** (`notice` in `fr.json`, `it.json` and `rm.json`). That line disappears once someone has
  proofread it – it is not decoration.

## Theme assets and shared runtime

`theme.js` follows the device appearance until a visitor makes an explicit choice.
Desktop uses a header button; compact headers group language and appearance in one native
menu, closed by Escape or a tap outside. Language choices remain real links. The theme
choice is a local preference (`kp-landing-theme`), shared across language pages on the same
origin. Keep `theme.js`, `build.mjs` and `landing.css` byte-identical in both repositories.
The builder embeds the runtime in the page head, including the single-file hand-out.
KP Front lists it as a Knip entry because the builder reads it as text rather than importing it.

Capture both real app palettes: the existing `shots/<name>.webp` is light, and
`shots/dark/<name>.webp` is its night counterpart, with matching names and dimensions.
Both heroes also have a 992px version. The link-preview JPEG and README PNGs remain light.
Do not simulate night mode by filtering a day screenshot.

```bash
node site/capture.mjs --site-only             # both themes, leave README PNGs alone
node site/capture.mjs --theme dark --site-only # night variants only
```

The offline builder preserves and embeds both picture sources; changing the theme must
never make the hand-out request an image from a server.

## Updating screenshots

```bash
node site/capture.mjs                        # against https://demo.kp-front.ch
node site/capture.mjs --base http://localhost:5188
node site/capture.mjs --only lage,mittel     # only individual images
node site/capture.mjs --scale 2 --docs-only  # refresh the README images at 2x
node site/build.mjs                          # then rebuild
```

`capture.mjs` drives a running instance with Playwright (from `node_modules`, no extra
dependency), selects day and night mode via the prefs cookie, skips the demo welcome dialog, hides the
DEMO banner and shoots every view at 1500 × 937. New images go in as a new entry in the
`shots` list in the script **and** as an entry under `shots.items` in `content/de.json` –
the filenames are the contract between the two. The filename lives only in `de.json`; the
translations inherit it and only provide the caption.

**The format is WebP** – the same capture weighs about half of what the old JPEG did, and
encoding happens in the Chromium that Playwright brings along anyway (no second dependency,
no `cwebp` on the machine). Day captures produce three outputs; night captures produce both WebP sizes:

| File | what for |
| --- | --- |
| `<name>.webp` (1500 px) | the tiles and the lightbox |
| `lage-992.webp` | the hero image on phones and 1x screens – it is never shown wider than 992 px (`.wrap` = 1040 px minus 2×24 px) |
| `lage.jpg` | **only** the link preview (`og:image`): WhatsApp, Facebook and co. don't show WebP |

The small version and the JPEG are derived from the one shot that carries `hero: true` in
the script.

Two things about the demo: it is shared with visitors and reset twice a day (00:00 and
12:00 Europe/Zurich). So for clean images, capture shortly after a reset – or use `--base`
against a local instance.

## Contact

Three channels, all without a backend of our own: two pre-filled GitHub issue templates
(`.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`) and a form that posts to
an external form service. Without JavaScript the form remains an ordinary POST.

Whoever renames the templates must update the `?template=…` links in `index.template.html`
along with them.

## Design

The look («Schweizer Plakat × Tageslicht») lives entirely in `landing.css`, and **this file
is identical in kp-front and kp-rueck**. Whoever changes the design copies it over to the
other repo – otherwise the two sister pages drift apart. Only template and texts differ:
content, images and the mutual cross-linking (`kp-front.ch` ⇄ `kp-rueck.ch`).

## Hosting

`site/` can be deployed as-is (static files, no server logic). `dist/index.html` and
`dist/fr/index.html` are the same pages as one single file each, with fonts and images
embedded – for passing around or for a host that only accepts one file.

### README images

Shots with `docs:` additionally write the same page state as PNG to `docs/screenshots/` –
which is why the README images used to be half a year older than the landing page. Both
outputs come from one capture but don't want the same resolution: the landing page embeds
the images inline (1x, page weight counts), the README images are viewed enlarged on
GitHub.

```bash
node site/capture.mjs                    # landing-page WebP (1x) + README PNGs
node site/capture.mjs --scale 2 --docs-only --only lage,gebaeude,atemschutz,mittel
```

`--docs-only` leaves the landing-page images untouched. The README images are currently 3000 px wide.
