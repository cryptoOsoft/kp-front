# Divera 24/7 connector – setting it up at a station

Connect the alerting system your brigade is already alarmed by, and an Einsatz opens itself the
moment Divera fires – with the address, the coordinate and the Stichwort already in it – while
the Mannschaft list keeps itself current overnight. **Read-only and pull-only:** KP Front never
writes anything back to Divera, does not set anybody's status, and does not alarm.

This document is the setup evening. The reference for the fields themselves is
[`CONFIGURATION.md` §6](CONFIGURATION.md#6-environment-variables-secrets--infra--operator-not-admin) (credentials) and
[§4a](CONFIGURATION.md#4a-divera--auto-sync) (`roster.autoSync`); a
station **not** on Divera wires its dispatch up through
[`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) instead.

**Contents**

- [What you need before you start](#what-you-need-before-you-start)
- [What the connector actually does](#what-the-connector-actually-does)
- [Step 1 – get the keys out of Divera](#step-1--get-the-keys-out-of-divera)
- [Step 2 – enter them in KP Front](#step-2--enter-them-in-kp-front)
- [Step 3 – register the webhook](#step-3--register-the-webhook)
- [Step 4 – what happens when an alarm lands](#step-4--what-happens-when-an-alarm-lands)
- [Step 5 – the Mannschaft sync and `roster.autoSync`](#step-5--the-mannschaft-sync-and-rosterautosync)
- [Step 6 – read the health rows](#step-6--read-the-health-rows)
- [Rückmeldungen – «Anrückend» in the Anwesenheit](#rückmeldungen--anrückend-in-the-anwesenheit)
- [What the connector will not do](#what-the-connector-will-not-do)
- [When something is wrong](#when-something-is-wrong)

---

## What you need before you start

- **An administrator login for your Einheit on divera247.com.** Everything below is in the
  browser Verwaltung; nothing needs Divera support.
- **A paid Divera tier for the webhook.** Divera's own documentation is explicit: the webhook
  („Datenübergabe") is available in the **ALARM** and **PRO** versions, with a quota of 10 and 20
  webhooks respectively, and the FREE version is limited to one alarm every five minutes carrying
  the Stichwort alone – no address. On FREE, only the fallback poll below is worth setting up,
  and it will see very little.
- **A public HTTPS address for your deployment** – Divera has to be able to reach it. If you
  installed with `./scripts/setup.sh --domain …`, that is the domain you gave it.
- Access to `/admin` on your KP Front deployment (the deployment admin secret).

Set aside an hour. The three links – webhook, poll, personnel – are independent: each works
without the other two, and KP Front tells you which one is missing.

---

## What the connector actually does

| Link | How | Set up with |
|------|-----|-------------|
| **Alarm intake – the primary one** | Divera POSTs each alarm to `/api/divera/webhook` the moment it fires | the webhook secret + a webhook in Divera (Step 3) |
| **Alarm intake – the fallback** | KP Front polls Divera's `/alarms` every **30 s** while no Einsatz runs and every **120 s** while one does (30 s again for the first 10 min after an alarm), and picks up anything it has not seen | the unit accesskey (Step 1) |
| **Mannschaft** | KP Front reads the members out of Divera nightly and on demand, and derives each person's **Dienstgrad** from their Qualifikationen | the personnel accesskey + `roster.autoSync` (Step 5) |
| **Rückmeldungen** | the same `/alarms` poll carries who answered «komme» / «komme nicht»; the Anwesenheit shows them as «Anrückend», yes / no only | nothing extra – the unit accesskey, plus the Mannschaft sync for the names ([Rückmeldungen](#rückmeldungen--anrückend-in-the-anwesenheit)) |

The webhook is the one that matters: it arrives in seconds, the poll within half a minute while
no Einsatz runs (up to two minutes during one). Run both – the poll is what covers the delivery
that never arrived, and a station on the webhook alone is **not** reported as stale for it
(Step 6).

---

## Step 1 – get the keys out of Divera

KP Front uses **two** accesskeys, and they are deliberately not the same one.

### The unit accesskey (alarms)

Divera's help for the alarm API names the place verbatim: *„Den Access-Key finden Sie als
Administrator im Menü unter **Verwaltung > Einstellungen > Schnittstellen > API**."* That key
belongs to the Einheit rather than to a person, which is what you want for a poll that has to
keep working when whoever set it up leaves the Wehr.

### The personnel accesskey (Mannschaft + Dienstgrade)

**Divera has no rank field.** What it has is per-member *Qualifikationen*, and KP Front maps
those names onto the station's own `roster.ranks` list, taking the most senior match
(`app/personnel.py` · `derive_rank_from_quals`). This is where the second key comes in:

> ⚠️ **The alarm key returns an empty `qualifications` list** – verified against a real
> `/pull/all` on 2026-07-01. It is not an error and nothing says so: the sync simply succeeds
> and every member comes back rankless.

Divera scopes `/api/v2/pull/all` to *„Daten gemäß der Berechtigung des aktuellen Benutzers"* –
a **personal** accesskey, whose holder's rights decide what comes back. Divera's public
documentation does not name the single permission that unlocks members' Qualifikationen, so this
is stated as an outcome rather than a click path:

**What you must achieve:** an accesskey belonging to a Divera user whose rights include reading
the Personal/Stammdaten of your Einheit, and whose `/pull/all` response carries a non-empty
`qualifications` list per member. A dedicated "Schnittstelle" user held by the Kommando is the
arrangement that survives a change of personnel officer. Divera's own granular permission model
(Personal / Einstellungen / Konto × ansehen, bearbeiten, erstellen, löschen) is what you set
this with.

Two constraints worth knowing before you design around it:

- A **Systembenutzer** (Verwaltung > Schnittstellen > System-Benutzer) does *not* help here.
  Divera's spec puts `/pull/all` behind the personal accesskey scheme only; the system user is
  for alarm and status **writes**, which KP Front never does.
- **2FA and rights changes break a personal key.** If the key stops seeing Qualifikationen, the
  ranks stop updating – the sync still succeeds, and Step 6 is how you notice.

### ⚠️ The key travels in the URL

Divera authenticates with `?accesskey=…` in the query string and takes it no other way, so **the
URL of every call KP Front makes to Divera is itself a secret**. That is why no Divera response
is ever passed to `raise_for_status()` in this codebase (`app/divera.py` · `DiveraApiError`): a
401 would otherwise print the key into the container log and into an editor's error toast. If
you reproduce a call with `curl`, treat your shell history the same way.

---

## Step 2 – enter them in KP Front

Open `/admin` → **Anbindungen** → the **Divera 24/7** group. Three slots:

| Field | Which Divera key | Empty means |
|-------|------------------|-------------|
| **Divera Accesskey** | the unit accesskey from Step 1 | no poll – the poll job returns on its first line. The webhook still works |
| **Divera Accesskey (Personal)** | the personal key that can see Qualifikationen | the sync falls back to the alarm key: **names only, no Dienstgrad** |
| **Divera Webhook-Secret** | *not a Divera value* – you invent it in Step 3 | the webhook answers **403** to everything, so nobody can inject fake alarms (fail-closed) |

All three are stored encrypted in this deployment's own database and take effect **without a
restart**. They are write-only: settable and rotatable, never readable back – including here.

> ⚠️ **`.env` wins.** A value set in `.env` (`DIVERA_ACCESS_KEY`,
> `DIVERA_PERSONNEL_ACCESS_KEY`, `DIVERA_WEBHOOK_SECRET`) outranks the stored one, and the
> browser field then reports itself as server-set and refuses to save (409). Leave those lines
> blank unless you deliberately want the environment, and nobody else, to own the value.

---

## Step 3 – register the webhook

### First, mint the secret

It is a shared secret between the two systems, and neither of them generates it for you – on
purpose, so it is never created for a station that is not connecting anything:

```bash
openssl rand -hex 32
```

Paste that same value into **two** places in one sitting: the **Divera Webhook-Secret** field
from Step 2, and the Divera webhook URL below.

### The endpoint

```
POST https://<your deployment>/api/divera/webhook?secret=<the secret>
```

The secret may travel either as the `?secret=` query parameter or as an **`X-Webhook-Secret`**
header – use the header if Divera lets you set one, so the secret stays out of your own proxy
logs. Anything without a valid secret is refused with 403 and nothing is stored.

### The Divera side

Divera's help gives the path: *„Zur Einrichtung gehen Sie in die **Verwaltung** Ihrer Einheit. Im
Bereich **Einstellungen - Schnittstellen** finden Sie den Punkt **Datenübergabe**"*, and, at the
bottom of that page, *„Ganz unten finden Sie den Bereich **Webhooks**"*. A webhook there carries
three settings: the **Ziel-URL**, the **Format** of the data, and the **Umfang** – how much of the
alarm is sent.

Portal screens change between versions and tiers, so take this as the outcome to reach rather
than a script:

**What you must achieve:** a webhook that fires on every Alarmierung, POSTs JSON to the URL
above, and carries the **full alarm** – Divera's Umfang options range from „Vollständiges Objekt
(inkl. Empfänger)" down to „Nur Stichwort"; anything narrower than „Textinformationen (Stichwort,
Meldung, Adresse)" costs you the address, and with it the map position and the weather.

What KP Front reads out of the delivery:

| Field | Becomes |
|-------|---------|
| `id` | the alarm's identity – **idempotent**, so a re-delivery is a 200 and not a second Einsatz |
| `number` | the Divera alarm number, kept on the record |
| `title` | the Stichwort. Classified into type and priority against the station's alarm vocabulary ([`CONFIGURATION.md` §1a](CONFIGURATION.md#1a-alarmkeywords--the-stations-own-alarm-vocabulary)) |
| `text` | the Meldung, shown with the alarm |
| `address` | the Einsatzort. Geocoded when no usable coordinate arrives |
| `lat` / `lng` | the coordinate. ⚠️ Divera sends `0/0` for an alarm without a location («Einrücken ins Magazin»); KP Front reads zero as **absent**, so the address geocoder runs instead of the map jumping to the Gulf of Guinea |
| `ts_create` | the alarm time – the Einsatz starts when Divera fired, not when the delivery arrived |

One restriction of Divera's that is worth knowing even though it does not affect you: its
webhooks cannot call a `divera247.com/api/...` URL. There is no loopback.

---

## Step 4 – what happens when an alarm lands

- **The Einsatz opens itself.** No wizard between the crew and the Karte (decided 2026-08-02);
  correcting type, priority or position afterwards costs seconds. An incident nobody attended is
  not silently counted – `editor_opened_at` stays empty and the statistics export drops it.
- **⚠️ Except while one is already running.** If an unarchived Einsatz was started within the
  last **4 hours**, the new alarm is *held in the pool* instead. A second alarm during a running
  Einsatz is far more often a Nachalarm or a reworded group SMS than a second Einsatz, and
  opening it would split the operational picture in two. The incoming-alarm banner then offers
  both «öffnen» and «zuordnen» – zuordnen is the one that keeps the GPS milestones together.
  A «Lernen ·» Übung (a tutorial, `source='training'`) never counts as running (05.11.2026):
  a learner practising at home must not hold the next real alarm.
- **Push goes out** to every subscribed editor browser, so a killed app still says «Neuer Einsatz»
  (needs the VAPID pair – [`SETUP.md`](SETUP.md)). The dispatch travels with `Urgency: high` and a
  TTL of ~2 h (`push.py · NEW_ALARM_TTL_SECONDS`), so a phone in Doze or briefly out of coverage
  still hears it when it wakes; the Atemschutz and Wiedervorlage re-notifies keep their 120 s. The
  service worker shows it with icon, badge and vibration, keeps it on the lock screen until
  somebody acts (`requireInteraction`) and sets the home-screen badge until the app has the alarm
  in front of the operator (`public/sw-notify.js`, `src/lib/push.ts · clearAppBadge`).
- **Whether THIS device would wake** is on the Karte home – «Auf diesem Gerät» › «Alarm auf diesem
  Gerät», and under Einstellungen › Gerät (`src/lib/alarmReadiness.ts`, 3am sweep §1,
  23.10.2026): installed · Benachrichtigung · Alarm-Abo · Anmeldung, each red row with its one-tap
  fix, «Testalarm senden» (`POST /api/push/test`, one push to the caller's own registration, one
  per minute) and the opt-out «Keine Alarme auf diesem Gerät» (push off, reversible there). A nudge
  card on the home shows when a row is red or nothing was checked for 90 days – never inside an
  Einsatz; «Später» hides it 30 days. A registration is dropped after 180 days without renewal
  (`SUBSCRIPTION_TTL_DAYS`); the app re-registers on every boot, and a device whose login has
  lapsed can renew with the subscription's own endpoint + keys as the credential
  (`POST /api/push/subscriptions/renew`, no session) – the login itself now lasts 90 days
  (`refresh_token_expire_days`), with rotation and revocation unchanged.
- **The pool is visible** at `/admin` → **Alarmierung**: the alarms taken from Divera that are
  not yet assigned to an Einsatz, plus «Aktualisieren» and a connection test.

---

## Step 5 – the Mannschaft sync and `roster.autoSync`

KP Front reads the members from `https://www.divera247.com/api/v2/pull/all` – note that this is
a *different host* from the alarm API – reconciles them against the local Personenstamm by their
`divera` external identity, and derives each person's Dienstgrad from their Qualifikationen
(Step 1). People you added by hand carry no such identity and are never touched.

Since 2026-09-11 the sync also runs **once a night** (04:17 Europe/Zurich, jittered). How much it
may do on its own is `roster.autoSync` in the deployment config – file-only, so it is set with
the CLI or in the config document, not in a form:

| value | what the nightly run does |
|-------|---------------------------|
| `"safe"` | **the default.** Applies joins, renames and Dienstgrad changes. A member who has left Divera is **counted and left active**, and the outstanding number is reported on System › Verbindungen – a disappearance is as often a broken feed or a changed scope as a resignation |
| `"full"` | the same, and stale members are **deactivated**. Never a deletion: every past Einsatz and Rapport keeps its names |
| `"off"` | nothing unattended. «Mannschaft synchronisieren» under `/admin` → **Personal** still works exactly as before |

Two guarantees hold at every level, and they are the reason this can be left on:

1. **A run that fetched no members at all applies nothing** and is recorded as a failure. Against
   an empty list every member of the station is stale, so one API hiccup would otherwise empty
   the Wehr overnight.
2. **A failed run never moves «zuletzt synchronisiert».** Last attempt and last success are
   separate facts, because a green tick standing through a fortnight of refused keys is the
   failure this connector is most likely to have.

Setting it, as part of the ordinary config loop:

```bash
cd backend
uv run python -m app.admin_config diff      # what would change
uv run python -m app.admin_config load      # apply
```

---

## Step 6 – read the health rows

`/admin` → **System & Wartung** → Verbindungen. Two of the rows are Divera's:

| Row | Written by |
|-----|-----------|
| `divera_alarms` | the poll (30 s / 120 s) **and** every authenticated webhook delivery. The webhook is the primary intake, so a station running on it alone is not stale |
| `divera_personnel` | the nightly sync **and** a hand-triggered sync, so «zuletzt synchronisiert» is true whoever pressed it |

Each row carries the last attempt, the last success, and the last error separately. `lastError`
never carries a credential – see the URL warning in Step 1. The same data is served by
`GET /api/system` (admin) for anything that is not the admin card.

---

## Rückmeldungen – «Anrückend» in the Anwesenheit

Since 2026-10-08 the Anwesenheit of an Einsatz with a Divera alarm (opened from it, or with an
alarm attached to it) starts with an **«Anrückend»** block for the EL and the editors. It shows
**yes / no and names, nothing else**: one line of counts («9 kommen · 2 kommen nicht · 3 da»), the
people who said they are coming, and «kommt nicht» in a group of its own, muted, with ✕ and the
word on every row – never colour alone. One tap on «da» checks somebody in. It shows no answer time, no status wording,
no note and no estimated arrival (owner, 2026-10-09: «just yes/no is enough»).

**⚠️ An answer is never presence** (X1, 08.10.2026). Nobody becomes anwesend because they pressed «komme» in
Divera: the block lists them, a person on the scene taps «da». Once somebody is recorded, whether
anwesend or gone again, they leave the block and stand in the list below.

Where the data comes from, so nothing new has to be set up:

- **The answers ride in the alarm poll.** Divera's `GET /api/v2/alarms` already carries, per
  alarm, `ucr_answered` (status id → user → answer). The poll reads which status each person
  pressed, maps the person onto the Mannschaftsliste through the `divera` external identity the
  Mannschaft sync stores, classifies the status, and stores on the pool row
  (`divera_emergencies.responses_json`) **only** our personnel ids under «kommt» / «kommt nicht»,
  plus a count of answers from people not on the list. It does not store the Divera user id, the
  status, the time or the note. A poll that saw nothing new writes nothing.
- **Timeliness.** For the first **10 minutes after an alarm** the poll keeps its 30 s cadence
  although an Einsatz now runs, because that is when the crew answers and the block is read. It
  drops to the running 120 s afterwards (`divera.RESPONSE_WINDOW_SECONDS`). Devices only read
  what the server stored (`GET /api/divera/responses/{incident}`, every 30 s while the block is
  on screen); they never make the server call Divera.
- **What counts as «kommt» / «kommt nicht»** is read off the status name (`/pull/all` →
  `cluster.status`): «nicht», «kein», «abwesend», «verhindert» → kommt nicht, checked first
  because «Komme nicht» also contains «komme»; «komm», «unterwegs», «einsatzbereit», «N min» →
  kommt. Any other answer («Rückruf erbeten») is ignored: neither shown nor counted. A station
  whose words differ sets `roster.diveraResponses`
  ([`CONFIGURATION.md` §4a](CONFIGURATION.md#4a-divera--auto-sync)); it applies to what the poll
  stores from then on. The names list is reused from the Mannschaft sync. Otherwise it is fetched
  at most every 6 h, or when an answer uses a status it does not know (at most every 15 min, 5 s
  timeout). Until a status can be classified, the poll keeps what it stored before.
- Several alarms on one Einsatz (a Nachalarm attached to it) are merged, and the newer alarm's
  answer wins. An alarm counts for **6 hours** (`RESPONSES_MAX_AGE_SECONDS`): a dispatch that is
  over is not «anrückend», and a Nachalarm the next day does not inherit the night's answers.
- **Privacy** ([`PRIVACY.md`](../PRIVACY.md) › Divera answers). The read is editor-only (EL and
  editors, not viewers and not an Einsatz-Link) and only for an open Einsatz. The answers are
  **deleted** when the Einsatz is closed and in any case 48 h after the alarm
  (`divera.prune_responses`, swept every 10 min). They never enter the workspace, an export or
  the Rapport.

> ⚠️ **Unverified (08.10.2026):** whether the **unit** accesskey's `/alarms` fills
> `ucr_answered` for every member or only for what that key «sees». The fields and their shape are
> taken from Divera's spec and four independent clients; it has not been run against a live
> Einheit. Check it on a Divera test Einheit before relying on it – never with a production key
> in a shell. If the block never appears although people have answered, this is the reason.

---

## What the connector will not do

- **It never writes to Divera.** No status, no alarm, no member change – there is no code in KP
  Front that can.
- **It does not sync vehicles, Status or availability.** Live vehicle positions are Traccar's
  job, and crew availability is answered in the Einsatz, not pulled. The alarm's Rückmeldungen
  are READ (above) and shown as what they are – an answer, never a check-in.
- **It does not create logins.** A synced person is a name on the Mannschaft list; who may log in
  is decided under `/admin` → **Mitglieder & Zugriff**, deliberately separately.
- **It does not alarm.** If Divera is down, KP Front is not a fallback alerting path; an Einsatz
  is opened by hand, which is a complete, supported setup.
- **It never deletes anybody.** `"full"` deactivates – a closed Einsatz resolves its names
  through those rows.

---

## When something is wrong

| What you see | What happened | What to do |
|--------------|---------------|------------|
| Webhook answers **403** | no secret configured, or the value does not match | check the **Divera Webhook-Secret** field and the URL registered in Divera – and remember `.env` outranks the stored value |
| Alarms arrive, but **up to 30 s late** (two minutes while an Einsatz runs) | the webhook is not registered (or the tier does not carry it) and you are running on the poll | Step 3; on FREE, this is the expected behaviour |
| **HTTP 401 / 403** on the row | the key is wrong, was rotated, or its scope changed | re-enter the accesskey. For the personnel key, the rights of its user are the usual cause |
| **HTTP 429** | polling too hard, or the tier's rate limit (FREE: one alarm per five minutes) | nothing to fix in KP Front; the next poll succeeds |
| Sync succeeds but **everybody is rankless** | the alarm key is doing the personnel pull – it returns an empty `qualifications` list | fill in **Divera Accesskey (Personal)** with a key that can read Qualifikationen (Step 1) |
| Ranks come back **unchanged after a Divera edit** | the qualification name does not match any entry in `roster.ranks` | compare the two lists; either rename in Divera or add the spelling to the station's rank list |
| A member who left is **still active** | `roster.autoSync` is `"safe"` – by design | deactivate them under `/admin` → **Personal**, or set `"full"` |
| A second alarm **did not open an Einsatz** | the split-dispatch guard: an Einsatz started less than 4 h ago is running | open or attach it from the incoming-alarm banner. Attaching is what keeps the milestones together |
| «zuletzt synchronisiert» **stands still** while the row is green | it cannot: a failed run does not move it. The row is telling you the truth – look at the last attempt and the last error |
