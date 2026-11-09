# SETUP – from nothing to a station that can run an incident

This is the **ordered path**, written for someone setting KP Front up for their own fire station
for the first time. It links to the reference docs rather than repeating them:
[`DEPLOYMENT.md`](DEPLOYMENT.md) is the infrastructure reference,
[`CONFIGURATION.md`](CONFIGURATION.md) is the config schema, and
[`STATION-DATA.md`](STATION-DATA.md) covers your private data repository.

Step 1 is one command and takes minutes. Budget an **afternoon** for steps 2–3, which is where
you make the deployment your station's, and a **second session** for the station data. You do not
have to finish everything before the app is useful: after step 3 it runs incidents on public
swisstopo maps with a hand-entered roster.

---

## 0. Before you start

Have these in hand. Every one of them is something people go looking for halfway through.

| You need | Notes |
| --- | --- |
| A Docker host | A 1 vCPU / 1 GB VPS is enough for one station. Disk grows with plans, photos, and audio – budget a few GB. |
| On that host: `git`, and Docker Engine with the **Compose v2** plugin | That is the entire list. The installer is plain bash – no `just`, no `uv`, no `pnpm`, and no `openssl` (it falls back to `/dev/urandom`, because a Debian netinst genuinely does not have openssl). The old standalone `docker-compose` will not work; this stack needs v2. |
| A browser | That is the whole toolchain for §3 and nearly all of §4. Making the deployment *your station's* – its name and colours, its crew, its vehicles and Mittel, its object plans, its map layers, its checklists, and the keys of every integration – is forms at `/admin`; a station can do all of it and never open a terminal again after §1, bar the two things no browser can do, which are backups (§6) and looking at a stack that is down (§7). The `uv` toolchain is needed only for **publishing a file you wrote** – the config-as-code path at the end of §3 and the bulk manifests in §4; everything you might otherwise want it for on the *server* – generating VAPID keys, printing what a deployment holds, restoring a config version – runs in the container that is already there, with `docker compose exec app uv run python -m …`. |
| A domain (recommended) | An `A`/`AAAA` record that **already points at the host** – the certificate is fetched for it during setup. The installer then runs Caddy for you, or, if something else on the host already owns 80/443, configures this deployment to sit behind it. Without a domain you run plain HTTP on a trusted LAN – see the gotcha in §7. |
| A decision: who administers this | Deployment administration is a **separate secret** from any user login. Decide who holds it. |
| Optional: a Divera 24/7 access key | Only if you want alarms and roster sync. Everything works without it. |
| Optional: your station's geodata | Hydrant layers, Leitungskataster, object plans. These are **never** bundled with KP Front – they are yours, and they come later in step 4. |

**One decision worth making now:** KP Front is single-tenant. One deployment serves one station.
If you are setting this up for several stations, that is several deployments, not one instance
with a switch.

---

## 1. Get it running

```bash
git clone https://github.com/feuerwehr-oberwil/kp-front.git
cd kp-front
git checkout "$(git tag -l 'v*' --sort=-v:refname | head -n1)"   # newest release, not main
./scripts/setup.sh
```

That is the install. `setup.sh` is plain bash and docker – it needs no `just`, no `uv`, no
`pnpm` and nothing else from this repo's development toolchain, because a station server has
none of them. (`just self-host` runs the identical script and exists only for developers;
`just` is never a prerequisite for hosting this.)

**It asks three questions and derives the rest** – plus a fourth in one situation, below.

1. **Your domain, or empty for LAN only.** That single answer decides `DOMAIN`, whether Caddy
   runs and fetches a certificate, `COOKIE_SECURE`, `APP_BIND` and `PUBLIC_URL`. You are never
   asked about `COOKIE_SECURE`, which is the whole point: plain HTTP with `Secure` cookies is a
   login that fails with no visible error, and nobody should have to know that twice.
2. **The host port**, default 8000. The collision is checked *before* anything starts, so a busy
   port is a question now instead of a failed `docker compose up` a minute later. A taken default
   proposes a free one; a port you asked for yourself with `--port` is a hard error instead,
   because quietly moving it would leave your proxy, firewall rule or bookmark pointing at
   nothing.
3. **Whether to back this station up every night**, at 03:30, keeping two weeks. This is the
   only question whose *yes* changes something outside the installation directory – it adds one
   line to your user's crontab – which is exactly why it is **asked and never assumed**. The
   prompt names the directory it would write to and how many nights it keeps; the crontab line
   itself is printed once it has been installed. It is then run once under cron's own near-empty
   environment, because an installed backup job that cannot find `docker` at 03:30 fails into a
   log nobody reads. Say no and it tells you plainly what you now do not have and how to add it
   later (`./scripts/setup.sh --backup-cron`, any time). §6 is the rest of that story.

⚠️ **The fourth question, and it can end the run.** If you give a domain but ports 80 and 443 are
already taken – another stack's reverse proxy, usually a KP Rück install on the same host – it
says so rather than fighting for 443, and then **asks** whether to configure this deployment to
sit behind your existing proxy at `127.0.0.1:<port>` instead. Answer no and the installer
**stops**, having written nothing: free 80/443, or re-run with an empty domain for a plain-HTTP
LAN install. Answer yes and `APP_BIND` becomes `127.0.0.1` and `PUBLIC_URL` your `https://` URL –
pointing the existing proxy at that port is then yours to do.

Then it generates the secrets, pins the version, starts the stack, and polls `/ready` with a
progress counter until the app answers. Migrations run on boot – there is no separate migrate
step. When something fails it says which thing failed and what to type, rather than printing a
stack trace.

**The Web Push keys do not go into `.env`.** Once the app answers, the installer logs into this
deployment's own admin API with the `ADMIN_SECRET` it made minutes ago and mints the **VAPID key
pair** in the encrypted credential store (§5). That is what makes an Atemschutz alarm reach a
tablet whose screen is off (§8 calls it safety-critical, and a missing pair is the kind of failure
nobody notices until the night it matters).

Webhook secrets are deliberately **not** generated at install. They are write-only – once saved,
the app can verify them but never reveal them. Pre-generating an unseen value would make an intake
look configured while no external alarm system could call it. When you connect Divera, FireHub or
another alarm system, generate one long random value, paste it into both
`/admin` → **Anbindungen** and the external system, and keep the handoff in that setup session.

They go into the store rather than into `.env` for one reason: **a value in `.env` wins and locks
its field in the browser** (§5). Minting into `.env` would hand every fresh station a page of dead
boxes on the one screen built to keep this off SSH – keys it could never rotate at 03:00. In the
store, the pair is rotatable at `/admin` → **Anbindungen**.

This step never fails the install. If it cannot run – no `curl` on the host, an empty
`ADMIN_SECRET`, an app that did not answer – it says exactly what is now missing and how to finish
it in the browser, and the rest of the install is unaffected. `--no-start` mints nothing at all,
because there is no running app to write through. Either way,
`./scripts/setup.sh --credentials` re-runs just the Web Push step against an installed deployment;
it never overwrites a pair the station has since set or rotated, and never one that `.env` owns.
**One state it does replace: a credential the store can no longer decrypt.** That happens when
`SECRET_KEY` changed (§7) – the stored bytes are already dead, the app itself asks you to set the
value again, and the run says which one it replaced.

`PRINT_AGENT_SECRET` is deliberately *not* minted, and the reason is not a background job: the
print-job sweep is registered either way and finds nothing to delete while no relay runs. It is
that **the secret is the switch**. Setting it renders «Ausdrucken» on the Rapport and on
the capture poster for every station that owns no printer, and parks a permanently offline
connector on the System card. The agent lives on a second machine that is provisioned at a
terminal anyway (§5).

**The version you checked out is now the version that runs.** This used to be a trap: the
instructions had you check out a release tag while `.env` still said `KP_FRONT_TAG=latest`, so the
code you were reading and the image you were running were two different things. `setup.sh` closes that – on a `v*` tag
it pins `KP_FRONT_TAG` to exactly that release; off a tag it uses `latest` and says plainly that
`docker compose pull` will then move the station onto whatever is newest. See §6 before you
choose.

**Write down two things at the end.** The script prints the URL, the first login (tap
**«Führungsunterstützung»**, PIN as shown) and the **`ADMIN_SECRET`**. The `ADMIN_SECRET` unlocks
`/admin` and nothing ever shows it to you again. Back up the whole `.env` somewhere that is not
this server – it holds `SECRET_KEY`, and §7 is the list of what a lost or changed one costs you.

Re-running `./scripts/setup.sh` is safe: it refuses to touch an existing `.env` – regenerating
`SECRET_KEY` over a live deployment would invalidate every PIN *and* every stored credential (§7)
– and reports what the host is currently doing instead. The two things it *will* do on an existing
install are `--backup-cron` and `--credentials`, because neither writes to `.env`.

Two other ways to install – filling `.env` in **by hand**, and **building from source** – are
parked at the [end of §2](#two-other-ways-to-install), so they do not stand between you and a
login. Nothing below needs them.

### Installing without a terminal in front of it

A second station, a rebuild or a CI job needs the same install with nobody there to answer. Pass
the answers as flags. **With no terminal on stdin – piped, cron, CI – it never asks anything**,
so `--domain` or `--lan` is then required, and **without `--backup-cron` no backup schedule is
installed at all**: a crontab is not something to change because nobody was there to say
otherwise. It says so at the end rather than leaving you to find out.

```bash
./scripts/setup.sh --yes --domain front.example.ch --backup-cron --backup-dir /var/backups/kp-front
./scripts/setup.sh --yes --lan --port 8080 --no-backup-cron          # LAN, plain HTTP
```

| Flag | What it answers |
|---|---|
| `--domain <name>` | question 1, HTTPS with the `tls` profile |
| `--lan` | question 1, LAN only: plain HTTP, `COOKIE_SECURE=false` |
| `--port <n>` | question 2. A port you named yourself is never moved for you – a busy one is a hard error |
| `--backup-cron` / `--no-backup-cron` | question 3, yes / do not ask |
| `--backup-dir <dir>` | where the nightly backup writes (default `./backups`) |
| `--tag <version>` | pin `KP_FRONT_TAG` instead of deriving it from the checked-out tag |
| `--build` | build the image from this checkout instead of pulling the published one |
| `--no-start` | write `.env` and stop – nothing pulled, built or started, and no credentials minted |
| `--timeout <sec>` | how long to wait for `/ready` (default 300) |
| `--env-file <path>` | write somewhere other than `./.env`, for testing. `KP_ENV_FILE` does the same. ⚠️ A backup schedule is then **not offered at all**: `backup.sh` reads `./.env` for the database identity, so a scheduled dump would name the wrong deployment |
| `--credentials` | mint only the missing Web Push key pair into an installed deployment, then stop |
| `-y`, `--yes` | never prompt. Needs `--domain` or `--lan` |

`--help` prints the same list. Everything else stays derived: you never script `COOKIE_SECURE`,
`APP_BIND`, `PUBLIC_URL`, `TRUSTED_FORWARDED_HOPS` or the `tls` profile, because each of them
follows from an answer above and setting one by hand is how the two drift apart. (The last of
those is the one to know about if you write `.env` yourself instead: a domain means a proxy in
front, and a proxy means `TRUSTED_FORWARDED_HOPS=1` or every request in the world shares one
rate-limit bucket – [`DEPLOYMENT.md` §3](DEPLOYMENT.md#app_port-and-app_bind).)

### ⚠️ Green is not the same as "somebody can log in"

**Check the roster, not just `/ready`.** This is the failure that looks most like success:

```bash
curl -s http://127.0.0.1:8000/ready              # database + storage must both be "ok"
curl -s http://127.0.0.1:8000/api/auth/roster    # must NOT be []
```

`/ready` only knows about the database and the storage volume. It cannot tell you whether an
account exists, and there is an old released image where that is exactly what goes wrong: in
**v0.6.0**, seeding runs inside a
`try/except`, so a `SEED_PIN` the backend refuses is logged as *"Seeding failed (continuing)"* and
the deployment **comes up green with an empty roster**. Every container healthy, `/ready` ok, and
a login screen with nobody on it.

Newer builds refuse to boot instead and restart-loop, which is loud and unmissable
([`DEPLOYMENT.md` §8](DEPLOYMENT.md) is where you read the log). Both shapes are in the wild
right now depending on which image you run, so recognise either:

| What you see | Which image | What it is |
| --- | --- | --- |
| The `app` container restarting forever, logs say *"SEED_PIN is required in production"* | working tree / anything after v0.6.0 | The refusal, working as intended |
| Everything healthy, `/ready` ok, `/api/auth/roster` returns `[]` | old v0.6.0 image | The same cause, silently swallowed |

Same fix for both: a 6–12-digit `SEED_PIN` in `.env` that is not one of the well-known ones, then
`docker compose up -d --force-recreate app`. `setup.sh` performs this roster check itself – it
fails the install with that explanation, and on success says how many accounts the login screen
offers – so the two commands above are only yours to run on the by-hand path at the end of §2.

## 2. Take over the seeded account

First boot seeds one editor from `backend/app/seed_users.json`. Its PIN is the **`SEED_PIN`** that
`./scripts/setup.sh` generated and printed in §1 – not the `000000` in the seed file, which the
backend refuses to use in production precisely because it is public
([`seed.py`](../backend/app/seed.py) · `resolve_seed_pin`, the well-known-PIN blocklist).

**Logging in is a tap, a PIN and ✓.** The login screen is a kiosk: it lists the active
accounts as tiles and you pick a face, then type the 6–12-digit PIN and confirm with ✓ – the
pad shows one dot per typed digit and deliberately never reveals how long the PIN is. The seeded tile reads
**«Führungsunterstützung»** – that is the account's *display name*, and it is the only name a
human ever sees.

That convenience is also a privacy choice: the pre-login roster endpoint exposes each active
account's display name, role and colour so the tiles can render. On an internet-facing deployment,
use functional labels such as «FU 1» instead of personal names where roster enumeration is not
acceptable. This concerns login accounts only; the separate personnel roster remains behind a
session.

> **`fu` is a username, and you never type it anywhere.** It exists in the database and in the
> seed file, but no screen asks for it – and neither installer prints it, on purpose: they name
> the tile («Führungsunterstützung»), because an operator told to log in as `fu` has been handed
> a dead end (`scripts/init-env.sh` carries the reasoning in a comment). Nor does the API accept
> it: `POST /api/auth/login` takes the account's **UUID** as `user_id`, which callers read from
> `GET /api/auth/roster` ([`auth/router.py`](../backend/app/auth/router.py)). Posting
> `{"user_id": "fu", …}` fails with `422 uuid_parsing`, which reads like a broken deployment and
> is not one.

> **Nobody can log in?** That is an empty `SEED_PIN` on a first boot, in one of the two shapes
> §1 tabulates – a restart loop, or a green stack with an empty roster – and the fix is the one
> given there. An **existing** deployment is never affected: with the account already present
> nothing is seeded and no PIN is needed ([`seed.py`](../backend/app/seed.py) · `seed_users`).
>
> A login screen that comes up and says *«Keine Benutzer hinterlegt»* is a *different* failure:
> the app is running and the roster is genuinely empty. That means seeding was turned off
> (`SEED_DATABASE=false`) and nobody created an account – fix it at `/admin`, which needs only
> `ADMIN_SECRET`.

1. Log in with it, so you know it works.
2. **Change the PIN**, and do it at `/admin` → **«Mitglieder & Zugriff»** – there is no
   self-service PIN change anywhere in the field app. Setting a PIN is an admin-session
   operation ([`auth/router.py`](../backend/app/auth/router.py) · `reset_pin`), by design: PIN reset is
   out-of-band, so a stolen tablet cannot lock the crew out of its own account. The six
   well-known PINs – `000000`, `123456` and their kind – are **refused by the server**, not
   merely discouraged: it is the same list the seeder applies at boot.
3. On the same page, create the accounts your crew will actually use. Once they exist, the seeded
   account is either renamed to a real person or deactivated – accounts are deactivated, never
   deleted, so the audit trail keeps pointing at somebody.

Incident roles are three: **`editor`** may change incident state, **`el`** (Einsatzleiter)
reads everything and keeps only the record – Anwesenheit, Material, Checklisten, Rapport –
while map and plans stay view-only for it, and **`viewer`** is read-only.
Deployment administration is not a role – it lives behind `ADMIN_SECRET` and is fail-closed, so
an unset secret means the admin surface is simply off.

### Two other ways to install

Neither is needed if §1 worked; they are here rather than in §1 so they do not sit between a
fresh host and a login.

**By hand.** `scripts/init-env.sh` is the non-interactive half of the same code – it generates
the four secrets into `.env`, asks nothing and starts nothing. You then review `DOMAIN`,
`APP_PORT`, `COOKIE_SECURE` and `KP_FRONT_TAG` yourself and bring the stack up:

```bash
./scripts/init-env.sh        # (or `just init-env` on a developer machine)
# edit .env, then one of:
docker compose --profile tls up -d   # with a domain – automatic HTTPS via Caddy
docker compose up -d                 # plain HTTP on a trusted LAN – set COOKIE_SECURE=false, §7
```

Then run both checks from §1 yourself: `setup.sh` performs the roster check for you and this
path does not. A `storage` failure is almost always a volume-permission problem, and it is much
easier to fix now than after you have data.

This path also skips everything §1 does *after* the four secrets, so on this path they are
yours to do. Both halves have a one-command version that works against an existing `.env`
without touching anything else: `./scripts/setup.sh --credentials` mints the **VAPID pair** into
the credential store (§5), and
`./scripts/setup.sh --backup-cron` installs the **backup schedule** (§6). Or set the credentials
by hand at `/admin` → **Anbindungen** – that page is the point of them.

**From source.** A station running a published release never needs this. Anyone who has been
told "that is already fixed on main" does:

```bash
./scripts/setup.sh --build
# or, on an existing install:
cp docker-compose.override.yml.example docker-compose.override.yml
GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
```

`setup.sh --build` passes the commit for you. Either way `/health` then names the exact commit the
image was built from, which is the only way to tell a source build of `main` apart from a published
image carrying the same release number.

The override is gitignored, so building from source edits no tracked file and creates no conflict
on the next `git pull`. In this mode `KP_FRONT_TAG` decides nothing – your working tree is the
version – and you must rebuild after every pull.

At this point you have a working incident app on public swisstopo maps. Everything below makes
it *your station's* app.

## 3. Make it your station

There are three doors into the same configuration document, and they write the same rows.
**Start in the browser.** Everything that makes the deployment recognisably yours – its name, its
colours, its logo on the Rapport, its doctrine numbers, its alarm groups, the people who log in
and the crew on the Anwesenheit list – is a form at `/admin`, and a station can run its whole life
that way. The **workbook** further down is the same lists as one spreadsheet, for when forty rows
would be forty forms. The **CLI** at the end is that same configuration as a file: reach for it
when you want the config reviewed, versioned or applied to more than one deployment, and for the
handful of things that genuinely have no form yet.

### Unlock `/admin`

`/admin` asks for the **`ADMIN_SECRET`** from §1 – not a user PIN, and not recoverable from the
running app. It is fail-closed: with no `ADMIN_SECRET` configured the whole surface answers 403
and tells you why, rather than presenting a login you could fail your way past
([`auth/dependencies.py`](../backend/app/auth/dependencies.py) · `get_current_admin`).

### Work down «Einrichtung»

The admin lands on **System & Wartung**, and on a fresh deployment the first card there is
**«Einrichtung»** – nine rows, each naming *what stays broken while it is undone* rather than
demanding you finish, and each a link straight to the page that fixes it.

| Row | Takes you to | Undone, that means |
| --- | --- | --- |
| «Name der Wehr» | Station & Karte | Login screen and Rapport show the product name, not yours |
| «Kartenmitte» | Station & Karte | Every new Lage starts somewhere arbitrary |
| «Brandmark hochladen» | Station & Karte | No logo on the login screen, no letterhead on the printed Rapport |
| «Eigene Zugänge» | Mitglieder & Zugriff | Only the one seeded account from §2 can log in |
| «Personal erfassen» | Personal | Anwesenheit and Rapport stay empty lists |
| «Fahrzeuge hinterlegen» | Fahrzeuge & Symbole | The Rapport has no grid for Ausrückzeiten |
| «Adresssuche eingrenzen» | Station & Karte | Address suggestions are not biased to the station's own area |
| «SharePoint-Anbindung» | Anbindungen | Nothing is pulled from the Wehr's own folders – object plans, geodata, checklists and the Arbeitsmappe stay whatever was last loaded by hand ([`sharepoint-connector.md`](sharepoint-connector.md)) |
| «Überwachung» | Anbindungen | `HEALTHCHECK_PING_URL` is unset, so an outage is nobody's news (§5, and [`DEPLOYMENT.md` §5.5](DEPLOYMENT.md#55-knowing-when-it-is-down)) |

The card follows one rule, and it is worth knowing because it explains what is *not* on it: **it
only ever lists things this UI can finish.** «Überwachung» used to be the exception – reported
below the rows, outside the «x von n» count, because the ping URL was env-only and a row nobody
could tick would have parked the card at «6 von 7» forever. It is now one of the seventeen
credentials «Anbindungen» sets, so it is an ordinary counted row like every other
([`SetupChecklist.tsx`](../src/admin/SetupChecklist.tsx) · `SetupChecklist`).

Opening incidents manually is a complete, supported setup, so «Alarmquelle» is deliberately not
one of these rows. Divera and generic webhook intake remain optional upgrades under
**Daten › Alarme & Einsätze** and **Anbindungen**.

Not every row is for every station – a Wehr that keeps no files in SharePoint will never tick
«SharePoint-Anbindung» by doing the work. Any open row therefore also carries **«Abhaken»**,
which records the decision in the deployment config (`setup.acknowledged`) rather than on the
tablet it was tapped on, so the next admin on the next device sees the same card.

⚠️ **A card with nothing left on it is not a finished setup.** «Eigene Zugänge» ticks as soon as
the deployment holds more than one account – it cannot see whether the setup PIN from §2 was ever
changed. It knows nothing about backups, HTTPS, or whether your `ADMIN_SECRET` is written down
anywhere. And it **disappears entirely** once every row is done, making it a nudge on the way in,
not a record to come back to. §8 is the list that decides whether you can rely on this in the
field.

### What the browser does

Every page below writes directly; the config pages autosave, so there is no Save button to
forget.

| Admin page | What you set there |
| --- | --- |
| **Station & Karte** | Name der Wehr, language, accent colour, Kommandant, map centre and zoom – and the **five** image slots, each uploaded with a live preview: **`logo`** (login screen and app brandmark), **`reportLogo`** (the letterhead on the printed Rapport, falling back to `logo` when empty), **`favicon`**, and **`iconPng192`** / **`iconPng512`** – the home-screen icons of the installed app, square PNGs at exactly those sizes (a larger square is accepted and scaled). Without the last two, a tablet that adds KP Front to its home screen shows *our* icon, not yours |
| **Doktrin** | Standard-Funkkanal, AGT-Kontaktintervall, warning lead time |
| **Journal** | The Verlauf text snippets that complete as you type |
| **Rapport** | Hours rounding, the attendance merge gap, Partnerorganisationen, and your station's own Formulare |
| **Fahrzeuge & Symbole** | The vehicle list – the rows of the Ausrückzeiten grid on the Rapport. A row needs both of its fields, in the order the page shows them: **Bezeichnung** (what the crew calls it, «TLF Steintal 11») and then **Kennung** (the short id, `tlf-11`, which auto-follows the Bezeichnung until you edit it). Incomplete or duplicate rows stay on screen with a warning instead of reaching the config, because the whole document is saved at once and one blank row would 422 every other Station page too |
| **Alarme & Einsätze** | The alarmable Gruppen (the Alarmierungs-/Ausrückzeiten grid on the Rapport), the three clocks on an incident's life – how long before it auto-archives, before it counts as stale, and how long the capture poster still reaches it – and the outbound `alarms.webhooks` that tell a second system an incident exists |
| **Kartenebenen** | Reference layers with their load status – and now their editors: **upload a GeoJSON** (hydrants, Leitungskataster) and it writes both the dataset and its layer entry; paste a canton's **WMS/WMTS** template as a raster layer. Replacing a GeoJSON writes the **same dataset id**, so the layer updates in place instead of gaining a twin |
| **Objektpläne** | The module catalogue with per-module coverage, and the Einsatzobjekte themselves: create an object, upload or replace its Modul-PDFs. Nobody types a UUID – you give the object a short, retypable key and the page hashes it to the same uuid5 the CLI derives, so a manifest later addresses *this* object instead of creating a twin |
| **Checklisten** | The FU/EL checklist templates: upload, replace, delete, and their per-page diagram assets |
| **Mitglieder & Zugriff** | Who may log in, with which role and which PIN; deactivate an account |
| **Personal** | The crew – hand entry, a CSV import with a downloadable template, or the workbook below |
| **Erfassungsblatt** | The A4 paper form for the fallback case – the capture poster itself now lives under Links & Zugänge |
| **Anbindungen** | The keys of every integration – Divera, Traccar, Web Push, speech-to-text, the two webhook intakes, the print relay and the monitor ping. Stored encrypted, live without a restart (§5) |
| **Arbeitsmappe** | The station's list-shaped data as one `.xlsx`: download, edit, upload back – see below |
| **Alarmierung · Fahrzeugortung** | Connection status, test calls, the alarm pool and the vehicle positions |
| **Links & Zugänge** | Every address the station hands out – capture poster, Einsatz-Link, Stations-Terminal, the fixed Atemschutz code and the Statistik-Export token: address, state, rotation and the printouts |
| **Einsatzhistorie** | Every incident with status, origin, rapport state |
| **System & Wartung** | Health, counts, storage |
| **Sicherung** | Export the whole config to a file, import one back, and **restore any previous version** |

**Sicherung is the safety net worth knowing about before you need it.** Every config write ever
made has kept the document it replaced, and «Letzte Änderungen» lists them – leading with *what
each write emptied*, because that is the difference between an ordinary edit and an accident, and
naming *what each write changed* rather than which sections it contained (every write stores the
whole document, so "contained" was the same nine names on every row). A burst of autosaves from one
hand collapses into a single entry, expandable, whose restore point is the state **before** the
burst – but a write that emptied something is never folded away. One button puts a kept version back. Until recently that table was reachable only over SSH, and this
project has needed it four times.

### What still needs a file

This used to be a table of a dozen rows. It is a short list now, which is the point – but it is
**not a promise of completeness**: `/admin` grows, and a list claiming to be exhaustive is a claim
somebody has to re-verify every release. The authority is `admin_config schema` against the build
you are running, and on a station server that command needs no toolchain –
`docker compose exec app uv run python -m app.admin_config schema`, as
[`DEPLOYMENT.md` §4](DEPLOYMENT.md#running-the-clis-on-a-host-that-has-only-docker) explains.

- **`mittel.units`** – the unit names («Stk.», «m», «l») the Mittel sheet offers. The workbook
  below carries the whole rest of the Mittel-Katalog but not this.
- **`alarmKeywords`** – the Stichwort table that maps an alerting system's wording onto this
  station's own. It is a paste-a-document, not a fill-a-form, and it is treated as one.
- **`roster.source`** – whether people come from a provider or are entered by hand. «Personal»
  edits the crew and the name order, not where the crew comes from.
- **Whole libraries at once** – a geodata manifest, an object-plan library, a set of checklist
  templates, or a config you want reviewed before it lands. Every one of those has a browser
  route for a *single* item (the table above); the CLIs are how you do four hundred of them,
  reproducibly, from a file you keep under version control. That is the next subsection.

⚠️ **`mittel.units` is the one most likely to surprise you**, because everything around it is a
form and it is not. Nothing breaks without it – §4's degradation table is exact – but a station
that meant to add «Rolle» to the unit list some evening will not find the screen.

**Where `alarmKeywords` and `roster.source` are set.** Neither has a form in `/admin`. Both are
keys of the config document, and there are exactly two places to write them:

- **In the browser:** `/admin` → Sicherung → Export, edit the key in the JSON, Sicherung →
  Import. No toolchain, works on a Docker-only station.
- **As a file:** in the `config.json` of your station-data repository, published from a
  workstation with `admin_config push` ([`STATION-DATA.md`](STATION-DATA.md)).

The shapes are in [`CONFIGURATION.md` §1a](CONFIGURATION.md#1a-alarmkeywords--the-stations-own-alarm-vocabulary)
(`alarmKeywords`) and [§4](CONFIGURATION.md#4-roster--personnel) (`roster.source`).

The same browser route, **Sicherung → Import**, covers `mittel.units`: export the config, edit
the JSON in a text editor, import it back. That covers every field in the
document, including the ones with no form. It is a **full-document replace** with exactly the
footgun described below – so the browser downloads a `kp-front-config-vorher.json` rollback file
first, and asks you to confirm
([`ConfigBackup.tsx`](../src/admin/ConfigBackup.tsx) · `runImport`).

Set the **locale** on Station & Karte. It is a per-deployment setting resolved once at boot, not a
per-device preference: one brigade, one language. German, French, Italian and English ship; German
is the canonical catalogue and anything untranslated falls back to it.

Then the roster – either Divera sync (§5) or manual entry / CSV import on the **Personal** page.
(The `.xlsx` sheet is still called `Mannschaft`, and so is the word for who is on an Einsatz –
the admin page for the standing crew is «Personal».)
See [`CONFIGURATION.md` §4](CONFIGURATION.md).

### The lists, in one spreadsheet

Typing forty people into a form is a bad evening. `/admin` → **Daten** → **Arbeitsmappe** hands
you the station's list-shaped data as one `.xlsx` – eight sheets, `Mannschaft`, `Dienstgrade`,
`Fahrzeuge`, `Mittel`, `Mittel-Bestände`, `Quellen`, `Partnerorganisationen`, `Symbolfelder` –
which you edit in Excel, Numbers or LibreOffice and upload back. It is **upsert only**: there is
no replace mode and there will not be one. Nothing is written until you confirm a preview that
names, per sheet, what would be added, changed, deactivated or removed, and quotes every refused
row with its sheet and row number. Re-importing an unmodified export changes nothing at all.

**Two rules you should not have to rediscover:**

1. **An absent sheet is not an empty sheet.** No `Fahrzeuge` tab and the fleet is untouched. A
   `Fahrzeuge` tab holding *only its header* clears the fleet – that is how you empty a list on
   purpose, and the preview says so before it happens.
2. **"Absent" means two different things.** A person missing from a present `Mannschaft` sheet is
   **deactivated**, never deleted, because past incidents resolve their name through that row. An
   id missing from an id-keyed sheet is **removed**.

⚠️ **The workbook is not a backup.** It carries the lists and nothing else – not your name,
language, accent colour, map centre, doctrine, alarm settings or Journal snippets, and
deliberately no keys, logos, Objektpläne, Kartenebenen, Formulare or Alarm-Stichwörter. Restoring
it restores none of those. The backup is «Sicherung» → Export plus «Letzte Änderungen»; the
disaster version is [`DEPLOYMENT.md` §6](DEPLOYMENT.md#6-backups--data-protection).

Two smaller things worth knowing. `mittel.catalogue[].when` and `fleet.vehicles[].winfapAlias`
are **carried over on an id match but not editable** here – a round trip never drops them. And
renaming somebody who carries a provider identity *and* a stored first/last split costs them that
split, after which they stop following `roster.nameOrder`; the preview warns when that would
actually happen.

### The third door: config as code

Everything above can instead live in one JSON file you keep under version control and publish to
the deployment. Same rows, same guarantees, and it is how you get a station configuration that is
reviewable, diffable and reproducible on a second deployment.

**This path needs `uv` on your own machine** (not on the server) plus a checkout of this repo.
Install it with `curl -LsSf https://astral.sh/uv/install.sh | sh`, or see
[the uv install docs](https://docs.astral.sh/uv/getting-started/installation/) for Homebrew and
Windows.

**Keep the file with your station data, not in this checkout.** It belongs next to your
Objektplan manifests in the private repository from [`STATION-DATA.md`](STATION-DATA.md). It holds
no secrets – no credential is a field of this document, by design (§5) – but it is your
station's document, and the only copy of decisions nobody will remember making. Do **not** write
it into `backend/private/`: that directory is gitignored, does not exist in a fresh clone (so the
shell redirect fails before `uv` even runs), and in a maintainer's checkout it is where another
station's live config sits.

```bash
mkdir -p ~/kp-station                        # your station-data repo
cd backend
uv run python -m app.admin_config example > ~/kp-station/config.json
# edit it: identity, branding, accent colour, map centre, fleet, doctrine, locale
uv run python -m app.admin_config validate ~/kp-station/config.json

export KP_BASE_URL=https://kp.meine-wehr.ch
export KP_ADMIN_SECRET=…                     # the ADMIN_SECRET from §1
uv run python -m app.admin_config push --dry-run ~/kp-station/config.json   # ← read this
uv run python -m app.admin_config push           ~/kp-station/config.json
```

`push` talks to the running deployment over its API, so it needs no database access and no
toolchain on the server – it works the same on docker-compose, Railway or anything else.

`push` refuses, without `--force`, anything that would **empty a section that currently has
content** – that is what publishing an outdated file looks like, and it is how a station loses
its Dienstgrade and its Partnerorganisationen in one command. It also carries over the parts the
deployment owns and your file never mentions (the uploaded brandmark, the reference layers), and
sends the version it just read, so a deployment somebody else changed in the meantime is a
refusal rather than a silent overwrite.

> **On the machine that holds the database** – a dev box, or `railway run` – you can use
> `diff` / `load` instead, which talk to `DATABASE_URL` directly. Same guarantees, no HTTP.
> They are *not* usable against a compose deployment: that Postgres is deliberately not
> reachable from outside the compose network, and it should stay that way.

⚠️ **Always run `push --dry-run` (or `diff`) first.** Every write here replaces the whole
document. If anyone has edited config through the admin UI since your file was written, a blind
write silently reverts their changes – this has bitten us on our own production deployment, four
times. **It gets more likely once the browser is where the edits happen**, not less: the file on
your laptop goes stale the moment somebody adds a Partnerorganisation on the Rapport page. Treat
`admin_config show` (or Sicherung → Export) as the *source*, edit that, diff, then push. If you
get it wrong anyway, «Sicherung» → «Letzte Änderungen» is the way back.

## 4. Load your station data (the second session)

Reference geodata, object plans, checklists and your own brandmark are **yours, not ours** –
nothing is bundled, and there is no fallback to another station's data. **A handful of each is a
browser upload**; a library of them is a CLI keyed off `KP_ADMIN_SECRET`:

| Data | One at a time, in `/admin` | A library at once | Format gotcha |
| --- | --- | --- | --- |
| Hydrants, Leitungskataster, cantonal WMS | Kartenebenen | `admin_geodata` | GeoJSON must be **WGS84 `[lng, lat]`**. LV95 is rejected – convert at import, never relabel. |
| Einsatzobjekte and their Modul-PDFs | Objektpläne | `admin_objects` | PDF plus a manifest. Missing plans fall back to OSM outlines and a Tafel, never to bundled files. |
| FU/EL checklist templates | Checklisten | `admin_checklists` | Falls back to one neutral bundled example if you load nothing. |
| Logo, Rapport-Briefkopf, favicon, app icons | Station & Karte | `admin_branding` | ⚠️ Load it **after** the config, never before – the ordering trap below. The odd CLI out: `push`/`load`/`show` only, no `schema`/`example`/`validate`, because a slot is one image file and there is nothing to validate a manifest against. |

**Which column you use is a question about volume, not about capability.** Four PDFs and a
hydrant layer are five uploads in a browser and there is nothing wrong with doing it that way –
the objects the page creates carry the same ids the CLI derives, so a manifest written later
addresses the same objects instead of duplicating them. Four hundred plans regenerated every
night are a manifest and a script. The branding row you have probably already done in §3.
Skipping it in both columns is the quiet failure – no logo on the login screen, no letterhead on
the Rapport, and our icon on every home screen.

[`STATION-DATA.md`](STATION-DATA.md) walks through building the private repository these come
from, starting from the synthetic Musterdorf example. Its **Definition of ready** section is the
checklist for this step.

**Read the worked example before you write your own.**
[`examples/demo-data/load.sh`](../examples/demo-data/load.sh) is this whole step as one runnable
script: config, brandmark, a hydrant/water layer, one Einsatzobjekt with module PDFs, checklists,
crew – six commands in the order they have to run. It is the shape your own load script wants,
and it carries the ordering trap in a comment: **branding is loaded *after* the config**
([`CONFIGURATION.md` §9a](CONFIGURATION.md#9a-what-all-of-them-share) says why; the demo lost
its logo and its letterhead to the other order).

### You do not owe anyone a complete inventory

The most common way this step stalls is a station deciding it must first enter *everything* – the
whole Mittel-Katalog, every vehicle, every Objektplan, the full Leitungskataster – before the app
is worth switching on. It does not, and waiting until it is complete is the worse outcome.

Every list here degrades on purpose:

| List | With nothing loaded | What partial gets you |
| --- | --- | --- |
| Mittel-Katalog | The Mittel sheet still works – anything missing is typed as «Anderes Mittel» and prints on the Rapport exactly like a catalogue line | The dozen things you actually use up (Schlauch, Schaummittel, Ölbinder, Leitkegel) turn a free-text list into two taps |
| Fahrzeuge / Gruppen | The Zeiten grid on the Rapport is simply omitted | The vehicles that really roll out give you Alarmierungs-/Ausrückzeiten without writing them by hand |
| Objektpläne | An incident falls back to the OSM building outline and a Tafel | The five or ten objects you would actually be sent to are worth more than four hundred you would not |
| Reference geodata | The map is the base map | One hydrant layer is already the thing an EL asks for first |
| Mannschaft | Every person is typed in as «Weitere Person» per Einsatz | The active crew makes Anwesenheit a tap instead of a keyboard |

The pattern is the same in each row: **load the part that earns its keep, use it, add the rest
when a real Einsatz shows you what was missing.** A station that loads its twelve most-used
Mittel and its four vehicles on a Tuesday evening is ready to run an incident that week – and
every row above is now something you add from a browser, so "the rest" costs an upload each,
not another scripting session.

Updating follows the same rule everywhere, because every route upserts. `admin_objects load`
matches on stable uuid5s derived per folder, so correcting one object is one command with one
object in the manifest, not a re-push of the library; `admin_geodata` and `admin_checklists` are
keyed per dataset; replacing a GeoJSON or a Modul-PDF in the browser writes the same dataset id,
so it updates in place rather than minting a twin; and the workbook (§3) upserts by id too.

⚠️ **`admin_config` is the exception, and it bites.** It writes the whole configuration document,
so a `load` of a file that is missing a section removes that section. Never load a config you have
not just diffed against what is live: `admin_config show > current.json`, edit *that*, diff, then
load.

### There are three doors, and one of them is not what it looks like

The CLIs above are not an alternative to "the JSON files" – **the manifest is what the CLI
reads**. There is no bulk import that is not a manifest, and no manifest that loads itself. What
actually differs is where the command runs and where the bytes come from:

| | What it does | When it suits you |
| --- | --- | --- |
| **Browser upload** | The `/admin` pages named in the table above: one GeoJSON or raster layer, one Einsatzobjekt and its Modul-PDFs, one checklist template. Replacing a file writes the same dataset id, so it updates in place. | Anything you can count on one hand, without a checkout. |
| `admin_* load` / `push <manifest>` | The CLI, either straight into this machine's database and storage or through a running deployment's API. Which verb belongs where: [`CONFIGURATION.md` §9a](CONFIGURATION.md#9a-what-all-of-them-share). | A whole library at once, or a load you want reproducible on a second deployment. `push` for anything remote. |
| **Scheduled pull** – ⚠️ **object plans only** | The deployment fetches from an **S3-compatible bucket** on a timer. | You already publish a plan library somewhere and would rather not hand anyone your `KP_ADMIN_SECRET`. |

The first two are the same door – both write `source_type = "uploaded"` through one code path,
deliberately, so both the CLI and the browser mint the same dataset id and cannot drift apart. An
object created in `/admin` from a short retypable key gets the uuid5 the CLI would have derived
from the same key, so the two never duplicate each other's work. The pull is the genuinely
different one (`source_type = "snapshot"`); it is described in
[`objektplaene-architecture.md`](objektplaene-architecture.md) and is the only option that
removes the need for any other system to hold a credential for this one.

⚠️ **The pull attaches plans to objects; it never creates them.** An Einsatzobjekt – the site,
its name, address and coordinates – comes from `admin_objects` or the admin UI, always. The pull
index carries an address but no name and no coordinates, so a plan whose object matches nothing
is **skipped, counted and logged**, and the run otherwise looks normal. Adopting the pull
therefore changes *how often* you run `admin_objects`, not *whether* you need it: with no objects
loaded, every plan in the bucket is skipped and the deployment shows none of them. Full rules in
[`objektplaene-architecture.md`](objektplaene-architecture.md).

⚠️ **…and if you run the pull, the objects have to come from `admin_objects` – not from the
browser.** The pull matches on the object's recorded **`source_key`**, the folder key in the plan
store. `admin_objects` sets it, by `load` or `push`; the admin form has no field for it and never
sends one (a save there keeps the key a CLI wrote). So an Einsatzobjekt created in the browser is
complete and usable – you upload its Modul-PDFs there, slot by slot – but the scheduled pull will
never find it, and its plans are counted as skipped on every run with nothing on screen to say
why, until a later `admin_objects load` or `push` of the same object gives it a key. The
Objektpläne page says this at the form. Two doors, one rule: **PDFs by hand → the browser is
fine; PDFs on a timer → the object has to have been loaded by `admin_objects`.**

⚠️ **The bucket pull covers object plans and nothing else.** `plan_pull` only ever writes
`plan:<object>:<module>` datasets, and the deployment config has no pull path at all. Plans-only
is no longer the whole story, though: a station that keeps its files in **SharePoint** can point
the SharePoint-Pull at its own folders and have Objektpläne, Geodaten, Checklisten and the
Arbeitsmappe fetched on a schedule – read-only, pull-only, no publisher script on the station
side. The setup afternoon (Azure app registration, consent, client secret, folder conventions)
is walked through step by step in [`sharepoint-connector.md`](sharepoint-connector.md); the
config fields are
[`CONFIGURATION.md` §6c](CONFIGURATION.md#6c-sharepoint-pull-the-stations-own-folders-imported-on-a-schedule).
A station on neither bucket nor SharePoint that wants geodata or checklists refreshed on a timer
still runs `admin_geodata push` / `admin_checklists push` from its own scheduler.

**You do not have to pick one and stay there.** All three write the same rows, so a station can
upload by hand for a year and switch to a manifest or a pull later without re-identifying
anything.

### Where the files actually live

Manifests carry **metadata**; the bytes travel separately and always land in **your** deployment's
storage – a directory on its own volume ([`app/storage.py`](../backend/app/storage.py)), served
back through `/api/reference/<id>`. That holds even for the scheduled pull: it downloads into
local storage and the bucket is never touched while an incident is running. A bucket is a
*source*, not a runtime dependency, and losing access to it costs you tomorrow's update, not
today's Einsatz.

| What you load | Bytes stored? |
| --- | --- |
| Object plan PDFs | Yes – one blob per `plan:<object>:<module>` |
| GeoJSON layers (hydrants, cadastre) | Yes |
| Checklist templates, and their per-page images | Yes |
| **WMS layers (cantonal services)** | **No.** The manifest holds a tile URL template and the browser fetches tiles directly – no storage, nothing to re-import when the canton updates. |

So budget disk for plans and GeoJSON, and nothing for WMS. If you are unsure how much, the plan
PDFs dominate and you already have them on disk – `du -sh` the folder your manifest points at. (The
*pull* index additionally records each plan's `size` and `sha256`, which is what lets a scheduled
run skip everything that has not changed; the manifest the CLI reads carries neither.)

### Nobody has to build a pipeline

Feuerwehr Oberwil regenerates its manifests nightly from a plan library and publishes them to a
bucket. **That pipeline is not part of this product and you do not inherit it.** The generator
lives in Oberwil's own private station-data repository, because every station's plan library is
shaped differently – theirs happens to be OneDrive, and `admin_objects` knows nothing about that
by design.

What you get is the **contract and the doors**: `admin_objects schema` prints the manifest's JSON
Schema, `admin_objects example` prints a filled-in one you can edit. Writing a generator is
optional and most stations will not need one – four PDFs uploaded by hand once a year is a
complete and supported answer.

### What this section is *not* about

Roster and incidents are a different axis and are handled in §5. `roster.source` decides where
**people** come from (`divera`, or `manual` for CSV plus hand entry); alarms arrive by webhook,
poller, or `POST /api/alarms` from anything at all. None of that touches the objects, plans,
geodata or checklists above, so an integration is never a substitute for this step.

## 5. Connect what you have (all optional)

Every integration is fail-closed: no credential means the feature is off, not broken.

**These go in the browser now.** The integration settings – the three Divera keys, the Traccar
trio, the VAPID trio, the four speech-to-text settings, `CARTO_API_KEY`, `ALARM_WEBHOOK_SECRET`, `PRINT_AGENT_SECRET`,
`HEALTHCHECK_PING_URL`, the Azure app registrations for the SharePoint pull, the SharePoint export
and «Mit Microsoft anmelden», the Objektbesuche organizer key, and the station-index and
roster-snapshot sources and tokens – are set at `/admin` → **Anbindungen**. They are stored
**encrypted** in this deployment's own database (AES-256-GCM under a key derived from
`SECRET_KEY`) and take effect **without a restart**. Three rules, once:

- **A value in `.env` wins and locks the field.** The browser box then reports itself as
  server-set and refuses to save (409). Nothing about an existing deployment changes, and nothing
  is migrated out of its environment: fill a line in `.env` only when you want the environment,
  and nobody else, to own that value.
- **Secrets are write-only.** An admin session can set and rotate them; nothing reads one back,
  here or anywhere. Only the non-secret fields are displayed – URLs and sources (Traccar, STT,
  station index, roster snapshot), the VAPID public key and contact, the STT model and language,
  the CARTO browser key, the Azure tenant and client ids, the SharePoint secret's expiry date and
  the Microsoft-login allow-list.
- **What stays in `.env`, and why.** `SECRET_KEY` peppers the PINs in the database it would
  otherwise live in; `ADMIN_SECRET` gates writing the very document it would live in;
  `KP_TELEMETRY_ENABLED`/`_DSN` are the deployer's veto *over* the admin UI, and an admin-settable
  veto is not a veto; `REQUIRE_PLAN_DIGEST` guards the config a stale publish overwrites; and the
  `POSTGRES_*` / `APP_PORT` / `APP_BIND` / `DOMAIN` / `COOKIE_SECURE` / `KP_FRONT_TAG` values are
  read before a database connection exists.

Full list and formats in [`.env.example`](../.env.example); the API is in
[`API.md`](API.md).

- **Divera 24/7** – `DIVERA_ACCESS_KEY` for alarms and roster. A second key
  (`DIVERA_PERSONNEL_ACCESS_KEY`) with permission to read Qualifikationen additionally derives
  each member's Dienstgrad. `DIVERA_WEBHOOK_SECRET` enables push alarms; without it, polling still
  works.
- **Any other alerting system** – `ALARM_WEBHOOK_SECRET` opens `POST /api/alarms`. No vendor
  account, no code. See [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md).
- ⚠️ **Webhook secrets are created during the integration handoff, not at install.** You cannot
  read one back after saving it. Generate a long random value, paste it into
  «Anbindungen» → «Webhooks» and the external alarm system in the same session. If the handoff
  value is lost, rotate it on both sides.
- **Traccar** – live vehicle positions on the Lage map.
- **Web Push** – **`./scripts/setup.sh` already did this one** on a fresh install (§1), and the
  pair is in the credential store, not in `.env`. To make one by hand – an older install, or a
  rotation – on a host with nothing but Docker:

  ```bash
  docker compose exec app uv run python -m app.gen_vapid   # prints both lines
  ```

  Paste **both** halves into `/admin` → «Anbindungen» → «Web Push». There is no restart: the
  value reaches its consumer on the next request. (Pasting them into `.env` instead also works,
  and is the deliberate way to lock them there – that route does need `docker compose up -d`,
  because `.env` is read once at process start.)

  Without the pair, Atemschutz and reminder alarms only fire while the app is in the foreground.
  **If your station relies on the Atemschutz clock, do this one.** Generate it once and keep it
  stable – rotating invalidates every subscription, so every tablet has to allow notifications
  again. ⚠️ **Half a pair is worse than none** – it leaves push «configured» and silently unable
  to deliver – so nothing, including `--credentials`, will ever replace one half for you. Set
  both, or neither.
- **Speech-to-text** – any OpenAI-compatible endpoint (Groq's free tier, OpenAI, or a self-hosted
  faster-whisper). Audio leaves your instance only if you set this.
- **Monitoring** – `HEALTHCHECK_PING_URL`, the dead-man's switch. It is the «Überwachung» row on
  the «Einrichtung» card, and [`DEPLOYMENT.md` §5.5](DEPLOYMENT.md#55-knowing-when-it-is-down) is
  what to point it at.
- **Station printer** – `PRINT_AGENT_SECRET` plus the polling agent, which lives in
  kp-rueck and serves both systems: see [`tools/PRINT-AGENT.md`](../tools/PRINT-AGENT.md).
  ⚠️ Setting this secret is what turns «Ausdrucken» (the station printer button) on, so set it when the agent exists –
  not before (§1).

## 6. Backups, before you rely on any of it

If you said yes to question 3 in §1, this is already running and you can skip to the drill.
Otherwise, one command:

```bash
./scripts/setup.sh --backup-cron     # installs the nightly line, then proves it runs
```

If a `scripts/backup.sh` line already exists – one pasted by hand from
[`DEPLOYMENT.md` §6](DEPLOYMENT.md#the-schedule), for instance – the command leaves the crontab
unchanged and still runs that existing command once under cron's environment to prove it works.
To perform the same check explicitly:

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME="$HOME" \
  sh -c 'cd /opt/kp-front && ./scripts/backup.sh /var/backups/kp-front'
```

That is a **crontab line on the host**, and it has to be: a scheduler inside the container
backing up its own volume dies with the thing it protects. The job captures the database and
the asset volume **together** – a database restored against a mismatched volume leaves media
rows pointing at blobs that aren't there – into `./backups`, keeping the newest `BACKUP_KEEP`
(14) of each. `./scripts/doctor.sh` tells you afterwards whether the schedule exists *and*
whether it has actually produced a file lately.

⚠️ **A backup on the same disk is not a backup.** Nothing in this product can copy files off
the machine for you; that is yours to arrange, and it is the half that survives a dead disk.

**Do one restore drill before you go live.** An incident record is only provably recoverable
once you have actually recovered it:

```bash
./scripts/restore.sh --dry-run backups/db-<stamp>.sql.gz   # says what it would replace
./scripts/restore.sh           backups/db-<stamp>.sql.gz   # type 'restore' to confirm
```

⚠️ **`--dry-run` restores nothing, but it may briefly start containers.** To tell you what it
would replace it starts the `db` container when needed and runs throwaway containers to count the
storage files. Nothing is dropped, written or overwritten, the app is never started, and a
database container started by the dry-run is stopped again before it exits.

It restores both halves together, refuses a dump whose storage tarball is missing or corrupt,
takes a safety copy of the current state first, and counts rows and files afterwards instead
of just declaring success. Do the drill on a **spare host or a throwaway copy**, not on the
station you are about to depend on. Details, and the failed-migration procedure, in
[`DEPLOYMENT.md` §6](DEPLOYMENT.md).

⚠️ **`.env` is in no backup, and `SECRET_KEY` peppers every PIN.** Restore a database under a
different `SECRET_KEY` and every account is locked out, indistinguishably from a wrong PIN. Keep
a copy of `.env` wherever you keep the `ADMIN_SECRET`.

Pin your version while you are here. A full version (`KP_FRONT_TAG=X.Y.Z`) follows nothing, the
series (`X.Y`) follows patch fixes, `latest` follows everything. A station that updates
deliberately wants one of the first two; which versions exist is the
[releases page](https://github.com/feuerwehr-oberwil/kp-front/releases). What a version bump
costs you is the table at the top of [`CHANGELOG.md`](../CHANGELOG.md). The reasoning behind
pinning – and why an update is something you schedule, never something that lands mid-incident –
is [`DEPLOYMENT.md` §5](DEPLOYMENT.md#5-updating).

---

## 7. The things that bite

**When something is wrong, start with `./scripts/doctor.sh`.** It is read-only – it starts
nothing and writes nothing, so it is safe to run mid-incident – and it names what it finds: a
port collision, a restart loop, an unwritable volume, a dead database, a green stack with an
empty roster, a storage volume filling up, a backup schedule that is missing or has quietly
stopped producing files. It prints the command that fixes each. It is the same diagnosis
`setup.sh` gives on install day; the difference is that you can run it on day 200.

It runs on the host and there is no browser equivalent, deliberately: the moment you most need
it is the moment the app serves no pages.

For a self-hosted storage ownership failure, the image's `app` user is UID/GID `10001:10001`.
The ownership repair printed by `doctor.sh` must match that runtime identity.

The rest of this section is ordered by how often it catches people.

1. **`SECRET_KEY` must never change.** It signs sessions, peppers PINs, *and* is the key every
   stored integration credential is encrypted under (§5). Rotate it and you get all three at
   once: everyone logged out, every PIN dead, and every credential in «Anbindungen» reporting
   itself as «unlesbar, bitte neu setzen» with that integration off until somebody types it in
   again. It is labelled rather than silently missing, on purpose – but it is still an outage.
   Back it up with your secrets, not with your code.
2. **Plain HTTP on a LAN needs `COOKIE_SECURE=false`.** Otherwise the browser silently drops the
   login cookie and sign-in fails with no visible error. `./scripts/setup.sh` sets this from your
   answer to question 1; it only bites on the manual path, or if you move a deployment from a
   domain onto a LAN afterwards.
3. **GeoJSON must be WGS84.** Swiss source data is usually LV95. Relabelling projected
   coordinates as latitude/longitude puts your hydrants in the North Sea.
4. **`admin_config load`/`push` replaces the whole document.** Run `diff` or `--dry-run` first.
   Every time. The browser's «Sicherung» → Import is the same full replace. Whichever one bit
   you, «Letzte Änderungen» on that page restores the version it overwrote.
5. **Postgres majors don't upgrade themselves.** A 16 volume will not be read by a 17 server.
   Stay on `postgres:16` for the life of the volume; to move, dump and restore into a fresh one.
6. **On Railway, mount the volume at `/mnt/data` and set `RAILWAY_RUN_UID=0`.** The image bakes
   `MEDIA_STORAGE_DIR=/mnt/data/storage`, Railway mounts volumes root-owned, and the image runs
   as uid 10001. On a **fresh** database that mismatch is not a `/ready` warning: every migration
   is pending, so `start.sh` tries to write its pre-migration dump under the mount, cannot, and
   **refuses the boot** – a restart loop with nothing listening and the reason only in the deploy
   logs. `/ready` reporting `storage: error` is the same cause on a *later* restart, once there
   is nothing left to migrate. The whole procedure is
   [`DEPLOYMENT.md` §3a](DEPLOYMENT.md#3a-railway-in-order).

## 8. Before you rely on it in the field

Not a formality – this is the list that separates "it's installed" from "we can run an incident
on it".

**This is not the «Einrichtung» card from §3.** That card has nine rows and asks *"does this
deployment look like your station yet?"* – it goes away as soon as it does. This list asks *"can
you rely on it?"*, and half of it is invisible to any browser: backups, HTTPS, where the secrets
are written down, whether push notifications actually arrive on a locked tablet. An empty
«Einrichtung» card gets you no further down this list than the first two items.

- [ ] `GET /ready` reports `database` and `storage` both `ok` – **and** `GET /api/auth/roster`
      returns accounts rather than `[]`. Green alone does not mean anyone can log in (§1).
- [ ] **The setup PIN is gone.** The `SEED_PIN` from §1 was generated for the install, not chosen
      by anyone, and it is sitting in your `.env` in plain text and in whatever you pasted it
      into. Real per-person accounts exist, and the seeded «Führungsunterstützung» account has
      either been renamed to a person and re-pinned, or deactivated. (Nothing in the app checks
      this: «Eigene Zugänge» ticks on account *count*, not on whether the PIN changed.)
- [ ] `ADMIN_SECRET` is stored somewhere you will find it in six months.
- [ ] Run a **Probe-Einsatz** end to end: open an incident, draw on the Lage, place symbols, run
      an Atemschutz Trupp to alarm, write Verlauf entries, print the Rapport.
- [ ] Do that Probe-Einsatz **with the tablet in flight mode** for part of it, and confirm the
      edits sync when you come back online. This is the feature you will need at 3am and the one
      least likely to be tested by accident.
- [ ] Confirm offline readiness reports what you expect on the tablet you will actually use.
- [ ] **A backup schedule exists and has produced a file.** `./scripts/doctor.sh` answers both
      halves; an installed cron line that has never written anything is not a backup. And a
      copy of those files lives somewhere that is not this machine.
- [ ] **One restore drill** – `./scripts/restore.sh` on a spare host or a throwaway copy, not
      on this deployment. Not `--dry-run`: an actual restore, then log in and open a photo.
- [ ] If Atemschutz matters to you: **the «Web Push (Alarmierung)» row on `/admin` → System &
      Wartung → «Verbindungen» is green**, and an alarm actually arrived on a locked tablet. That
      row is the check – not a grep of `.env`, which on a current install is empty by design
      because the pair lives in the credential store (§5).
- [ ] If you set up the SharePoint-Pull: the **SharePoint card on `/admin` → System & Wartung**
      shows a last *successful* sync per area, and its client-secret expiry countdown shows the
      date you expect. Put that date in the station's calendar too – Azure caps a secret at
      24 months and warns nobody when it lapses.

## 9. Where to go next

- [`CONFIGURATION.md`](CONFIGURATION.md) – every config field and asset format.
- [`STATION-DATA.md`](STATION-DATA.md) – building your private data repository.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) – updating, rollback, backups, troubleshooting.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) – how the pieces fit together, and why.

Stuck, or something here was wrong for your station? Open a
[discussion](https://github.com/feuerwehr-oberwil/kp-front/discussions) – setup friction is a bug
report we want.
