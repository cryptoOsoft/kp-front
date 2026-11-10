# Alarm integrations: inbound intake & outbound webhooks

*Status: shipped 2026-07-08. How alarms get **into** KP Front from any alerting system, and how
incident-created events get **out** to whatever a station wires up (slip printers, chat bots,
pagers). KP Front core stays printer- and vendor-agnostic; everything here is config.*

## The pieces

```
alerting system ──POST /api/alarms──► KP Front ──alarms.webhooks──► your adapter (printer/bot/…)
      (or Divera webhook/poll)           │
      │                                  └── auto-opens the incident; the Erfassungs-Poster
      │                                      (/e/<token>) reaches it for captureWindowHours
      └── puts /l/<token> in the alert ──► responder's phone: that one incident, read-only
```

## 1. Inbound: generic alarm intake – `POST /api/alarms`

For stations **not** on Divera (which has its own integration), or for scripts/dispatch
systems. Every accepted alarm **auto-opens an incident** – as does every other intake path
since 2026-08-02. Auto-open is no longer configurable and no longer filtered: an alarm nobody
attends is kept out of the statistics afterwards (`editor_opened_at`,
[`STATS-EXPORT.md`](STATS-EXPORT.md)), not kept out of the app beforehand.

- **Auth:** the alarm webhook secret, sent as `?secret=` or `X-Webhook-Secret`. Fail-closed:
  unset → 403 for everyone. Setting it is the opt-in.
  - **Where a station sets and rotates it: `/admin` → Anbindungen.** Create one long random
    value during the integration handoff and paste it into both KP Front and the sending system
    in the same sitting. It takes effect **without a restart**; rotating it invalidates every
    sender still using the old value.
  - It is **write-only**: the page can set and rotate it, never show it back. The installer does
    not pre-generate an unreadable value. If the handoff value is lost, rotate both sides.
  - `ALARM_WEBHOOK_SECRET` in `.env` still works and **outranks** the stored value, which then
    reports itself as server-set and refuses to save (409). Use it when you want this
    deployment's environment, and nobody with an admin session, to own the secret.
    [`CONFIGURATION.md` §6](CONFIGURATION.md#6-environment-variables-secrets--infra--operator-not-admin).
- **Idempotent when you send `source_id` – and only then.** One incident per
  `(source, source_id)`: a retried delivery returns the existing incident (`200`,
  `"created": false`) instead of duplicating it. `source_id` is **optional**
  (`backend/app/schemas.py` · `AlarmIn`), because KP Rück always allowed it to be and one relay
  has to feed both. ⚠️ Omit it and there is nothing to dedupe on, so the server does not even
  look (`api/alarms.py`): every redelivery – a retry, a timeout your side, a webhook fired twice
  – **creates another incident**. Send the upstream's own alarm id unless you genuinely have
  none.
- `type`/`priority` fall back to the same keyword inference the Divera path uses – the alarm
  keyword vocabulary is not vendor-specific, and a station whose dispatch words differ replaces
  it from its deployment config (`alarmKeywords`, [`CONFIGURATION.md §1a`](CONFIGURATION.md)).
- **Send `started_at`** – the moment the alarm went out, not the moment you POST. It becomes
  the incident's Alarmierungszeit, and it is what the Rapport prints and the statistics
  export joins on. Omit it and the incident falls back to the time the request arrived, which
  is recorded as having *unknown* provenance (`started_at_source: null` in the export) so no
  downstream consumer mistakes your delivery time for an alarm time. The Divera integration
  does the same thing with the alarm's own `ts_create`.
- `source` is a short slug naming the upstream (`leitstelle`, `pager`, …). Seven are reserved and
  rejected with `422`: `divera`, `feld`, `intake`, `manual`, `migrated`, `operator`, `training` –
  the union with KP Rück's list, so one sender can address both systems (see below). The
  authoritative copy of that set is [`alarm-intake-conformance.json`](alarm-intake-conformance.json)
  (`reserved_sources`), which both repositories test against; this prose follows it.

```bash
curl -X POST "https://front.example.org/api/alarms?secret=$ALARM_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "leitstelle",
    "source_id": "E-2026-0815",
    "title": "BMA Alarm Musterstrasse",
    "address": "Musterstrasse 5, 9999 Musterdorf",
    "lat": 47.5, "lng": 7.5,
    "priority": "HIGH",
    "started_at": "2026-07-08T14:32:00+00:00"
  }'
# → 201 {"incident_id": "…", "created": true}
```

### Contract stability

What a sender can rely on:

- **Additive only.** New optional fields may appear; existing ones will not be removed,
  renamed, or made stricter within a major version. Unknown fields in your payload are
  **ignored**, so sending extra keys is safe and forward-compatible.
- **A breaking change to this endpoint is a MAJOR release**, with the migration written up in
  [`CHANGELOG.md`](../CHANGELOG.md). It will not happen in a patch.
- **Idempotency is part of the contract**, not an implementation detail: retrying the same
  `(source, source_id)` is always safe. It is a contract about that *pair*, though – a payload
  with no `source_id` has no identity to retry under, and duplicates on redelivery by design.

### Talking to both KP Front and KP Rück

KP Rück has an endpoint with the same name and the same idea, but the two are **independent
implementations, not one shared specification** – they were built for different jobs and their
payloads have drifted. If you are writing one sender for both, stay inside the portable subset:

| Field | Portable | Notes |
| --- | --- | --- |
| `title` | ✅ required by both | KP Rück caps it at 255 characters |
| `source` | ✅ | Keep it ≤16 chars and matching `^[a-z0-9][a-z0-9_-]*$` – KP Front is the stricter of the two |
| `source_id` | ✅ **always send it** | Optional in both since 2026-08 – it used to be required here, which is exactly why one relay could not feed both. Optional is not "skip it": without it neither app can dedupe your retries |
| `text`, `address` | ✅ | KP Rück caps them at 5000 / 500 characters; KP Front caps `address` at 255 – keep it ≤255 |
| `lat` + `lng` | ✅ | WGS84, both or neither |
| `type`, `priority`, `started_at` | KP Front only | Ignored by KP Rück |
| `number` | KP Rück only | Ignored by KP Front |

Avoid the union of both reserved `source` slugs: `divera`, `feld`, `intake`, `manual`,
`migrated`, `operator`, `training` – the seven in
[`alarm-intake-conformance.json`](alarm-intake-conformance.json), which is the file both
repositories' tests read.

**Do not share a response parser.** KP Front answers `{"incident_id": …, "created": …}`;
KP Rück answers `{"status": …, "created": …, "emergency_id": …, "auto_attached_incident_id": …}`.
Only `created` means the same thing in both.

### Milestone enrichment – `POST /api/alarms/milestones`

The alarm pipeline can push per-group alarm times and per-vehicle Ausrück/Vor-Ort/Zurück
times as they happen (e.g. derived from GPS geofence events). Same secret as the intake;
targets an existing incident by `divera_id` **or** the intake's `(source, source_id)` pair –
**404 while none matches** (send with retry/backoff; dispatch precedes take/auto-open by
minutes at most). Idempotent per-key upsert into the incident's Rapport fields; entries an
operator edited (`manual`) are never overwritten; unknown ids are kept verbatim. Each NEW
value also appends a journal row («TLF ausgerückt 03:16»). Group/vehicle ids should match
`alarms.groups[].id` / `fleet.vehicles[].id` in the deployment config.

```bash
curl -X POST "$BASE/api/alarms/milestones" \
  -H "X-Webhook-Secret: $ALARM_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{
    "divera_id": 4711,
    "origin":   "alarmzentrale",
    "groups":   [{ "id": "g2",  "alarmedAt":  "2026-07-13T01:12:00Z" }],
    "vehicles": [{ "id": "tlf", "ausgerueckt": "2026-07-13T01:16:40Z" }]
  }'
# → 200 {"incident_id": "…", "applied": 2}   (replay → "applied": 0)
```

**`origin` (optional)** – where the alarm came *in* from, as the alerting system knew it: a
short lowercase slug such as `alarmzentrale`, **never a phone number**. It answers a question
none of the other fields do — a dispatch and an alarm somebody raised by hand are usually
both allowlisted and otherwise identical here — and it is what a consumer needs to decide
whether an Einsatz may reach a public surface.

It is recorded **write-once** on the incident (`alarm_origin`, exposed in the stats export):
the first milestone carrying it wins and no later one rewrites it, for the same reason
`confirmed_at` is a latch. It does **not** count towards `applied` and appends no journal row
— it is a property of the alarm, not something that happened during the Einsatz.

Omitting it is normal and means *unknown*, not *no*. Senders that cannot know the origin —
notably a fallback relay running while the main service is unreachable — simply leave it out.

### FireHub (Tercero) – `POST /api/firehub/webhook`

FireHub has **no** public REST API for our use case, but it fires **station-configured
webhooks** on the triggers «Einsatzstart» and «Einsatzende». Point both at
`POST /api/firehub/webhook`; there is nothing to configure server-side, and nothing to key
`configured` off, so the capability registry lists FireHub as a discoverable-but-unconfigured
choice under the `alarms` domain.

**Auth: put `?secret=…` in the target URL.** The webhook target URL is freely choosable, but
FireHub's JSON **schema and headers are fixed** (a payload-wide format, not per-webhook
configurable), so a custom `X-Webhook-Secret` header is not an option. The station appends
`?secret=<alarm_webhook_secret>` to the URL instead – the **same `alarm_webhook_secret`** as the
generic intake above, fail-closed when unset.

Payload sent (as of 2026-08):

```json
{
  "operation": {
    "opsID": 1,          // STABLE, never changes → idempotency + start↔end link key (source_ref)
    "opsNumber": 1,      // human reference ("E-1"), VOLATILE (merges/backfills) → display-only, ignored
    "category": "firealarm",
    "title": "Oberwil: Feueralarm",
    "street": "Teststrasse 112",
    "city": "Oberwil",   // added by Tercero shortly after this adapter – omitted by older payloads
    "created": "2026-08-24T18:25:07.000Z"
  },
  "status": "OK",
  "trigger": { "type": "operation", "action": "start", "techName": "operation_start" }
}
```

- **`action: "start"`** → **auto-opens an incident**, exactly like the generic `POST /api/alarms`
  path (title ← `title`, address ← `street` + `city`, Alarmierungszeit ← `created`; `category`, an
  English slug, is deliberately not mapped – the German title already carries the keyword the
  type inference reads). Idempotent on `(source="firehub", source_id=opsID)` – and because
  **`opsID` never changes** while **`opsNumber` can** (operations merged, past ones backfilled),
  the dedup/link key is `opsID`, never the display number. A redelivered start returns the
  existing incident. It does **not** use the Divera pool – that pool is keyed by `divera_id` and
  is Divera's; FireHub rides KP Front's provider-neutral intake, source-tagged.
- **`action: "end"`** → **stamps the Einsatzende** on the matching incident's Rapport
  (`Incident.closed_at`, which the sheet reads as `reportMeta.endedAt ?? closed_at`, so an
  operator-entered value still wins). FireHub sends no end timestamp, so the receipt time is
  used, and `closed_at` is write-once – a redelivered end, or one arriving after the operator
  already closed the Einsatz, changes nothing. It is **not** archived/closed: retiring the
  Einsatz and releasing its crew stays the operator's decision (`is_open` ignores `closed_at`).
  An `end` for an operation we never opened is a no-op. A Wehr that does not want the stamp
  simply does not wire the Einsatzende webhook.
  - **This is the one place KP Front and KP Rück behave differently on purpose.** KP Rück does
    not own the Einsatzrapport, so its `end` only records an audit-log note; KP Front owns the
    Rapport, so its `end` stamps the Einsatzende there. Start behaviour, the field mapping, the
    source slug and the auth are identical between the two.
- **Limits today:** FireHub sends **no coordinates** – the map pin is geocoded from the
  composed `street` + `city` address (the `lat`/`lng` field aliases are already wired for the
  day Tercero adds them). `city` itself is a payload-wide addition still rolling out, so the
  address degrades to street-only for older payloads. Personnel/response data exists in FireHub
  but is not sent by webhook yet.

## 2. Outbound: incident webhooks – `alarms.webhooks`

Deployment config (`docs/CONFIGURATION.md` §1):

```jsonc
"alarms": {
  "webhooks": ["https://printer-adapter.local/kp-front"]
}
```

Two events go to every URL – **fail-open**: retried (0s/2s/8s), logged, never blocking or
delaying intake. **Switch on `event`:** a receiver that acts on everything it is handed
(prints a slip, pages someone) would act twice for one Einsatz.

### `incident.created`

Every incident creation (manual wizard, Divera take, Divera auto-open, generic intake)
POSTs this JSON:

```jsonc
{
  "event": "incident.created",
  "incident": {
    "id": "…", "title": "BMA Alarm Musterstrasse",
    "type": "BMA / unechte Alarme", "priority": "HIGH",
    "address": "Musterstrasse 5, 9999 Musterdorf",
    "lat": 47.5, "lng": 7.5,
    "source": "leitstelle", "source_ref": "X-1",
    "started_at": "2026-07-08T14:32:00+00:00",
    "auto_opened": true
  },
  "capture_url": "https://front.example.org/e/<token>"   // null unless PUBLIC_URL is set
                                                          // AND the Erfassungs-Poster is active
}
```

Set `PUBLIC_URL` (env) to the deployment's public origin so `capture_url` can be composed.

`source_ref` is the **upstream's own id** for the alarm (the `source_id` a generic intake
sent, or the Divera alarm id) – `null` for manually created incidents. It is what lets a
sender correlate this event with an alarm it is still holding something for: the milestone
pipeline (§1, `POST /api/alarms/milestones`) answers 404 until the incident exists, so it
subscribes to this webhook and delivers its queued times the moment one opens, instead of
waiting out its retry cadence.

### `alarm.attached`

A dispatch center may split one physical Einsatz into several alarms (Nachalarm, reworded
group dispatch), and an Einsatz opened by hand (incl. an Übung) has no alarm at all until
one is attached to it – `POST /api/divera/pool/{divera_id}/attach/{incident_id}`. Nothing
is created there, so `incident.created` does not fire; this does:

```jsonc
{
  "event": "alarm.attached",
  "incident": { "id": "…", "title": "Übung Atemschutz", "source": "manual" },
  "alarm":    { "source": "divera", "source_ref": "36591264" }
}
```

The attached alarm sits in its own block because the incident's own `source`/`source_ref`
describe how the *Einsatz* was opened, which after an attach is no longer where its times
come from. Everything a sender holds pending for `alarm.source_ref` now belongs to
`incident.id` – the same flush as above, for the case where the incident already existed.

### Example adapter: kp-rueck thermal QR slip

If the station runs [kp-rueck](https://github.com/feuerwehr-oberwil/kp-rueck) with its print
agent, a per-alarm slip (times + capture QR) is a few lines – kp-rueck's existing
`POST /api/print/qr-code` does the printing:

```python
# tiny webhook receiver → kp-rueck slip. Run anywhere both hosts are reachable.
from fastapi import FastAPI, Request
import httpx

KP_RUECK = "https://kp-rueck.example.org"
app = FastAPI()

@app.post("/kp-front")
async def incident_created(req: Request):
    p = await req.json()
    if p.get("event") != "incident.created":
        return {"ok": True}  # an attach is not a new Einsatz — one slip per Einsatz
    inc, url = p["incident"], p.get("capture_url")
    label = f"{inc['title']}\n{inc.get('address') or ''}\nAlarm: {inc['started_at'][11:16]}"
    # kp-rueck's endpoint has a TRAILING SLASH, requires `title`, calls the payload field
    # `qr_content`, and is editor-gated — so the receiver needs a logged-in kp-rueck session
    # cookie (or a master token), not just network reachability.
    async with httpx.AsyncClient(cookies=KP_RUECK_SESSION) as c:
        await c.post(f"{KP_RUECK}/api/print/qr-code/",
                     json={"qr_content": url or inc["id"], "title": inc["title"],
                           "subtitle": label})
    return {"ok": True}
```

## 3. The Erfassungs-Poster (station capture)

The admin UI (System › Links & Zugänge, the «Erfassung» row) prints a **static A4
poster** for the Magazin wall. Scanning it opens `/e/<token>` – attendance, material,
Einsatzende and notes for incidents of the last `alarms.captureWindowHours` (default 12),
no login. Trust model: access to the station = permission, like the clipboard it replaces.
Rotate the token in the admin UI to invalidate every printed poster at once; delete it to
turn the surface off (fail-closed).

## 4. The Einsatz-Link (read-only link into one incident)

The poster's sibling, for the people who are not at the Magazin: the alerting system puts a
**URL into the alert it sends out**. A responder taps it on a personal phone and sees *that one
incident* the way a `viewer` account sees it – Lage map, Pläne, Hydranten, Checklisten, Verlauf.
No login, and nothing that writes, prints, costs money or leaves the building. Any alerting
system can do this; Divera is only the common case.

Two more links land on the same `/l/<token>` door and are minted **in the app**, not by the
alerting system: the Rapport's view link (`/l/v…`, survives the Einsatz closing, revoked per
incident) and the **Atemschutz-Link** (`/l/a…`, minted from a running Einsatz by an editor via
«Überwachung abgeben» or «Weitergeben › Nur Atemschutz»). The Atemschutz-Link is the one link that
writes: it lets a non-FU operate the Atemschutzüberwachung of that Einsatz from their own phone,
and its writes are exactly three routes – the `trupps` slice of the workspace, `kind: team` Verlauf
rows and `atemschutz.*` audit events, all stamped `atemschutz-link`. It dies when the Einsatz is
closed or the link is revoked. Everything else below applies to it unchanged.

Since 2026-09-02 an editor can also mint **this** link – the alarm one – from inside the app:
«Teilen › Einsatz-Link (nur lesen)» in the Einsatzkopf (`POST /api/incidents/{id}/einsatz-link`),
so the Zentrale, the EL or a Nachbarwehr can be handed a live read-only view mid-Einsatz. It is
signed with the same station key, opens the same read-only session and dies under the same two
conditions (Einsatz closed, or key rotated), so nothing about the session differs. The only
difference is inside the token: an app-minted one names the incident by its own id (`inc`) rather
than by `src`/`ref`, because that pair exists so an *alerting system* never has to learn our
UUIDs – and a manually created Einsatz or an Übung carries no `source_ref` at all. With no
`incident_link_key` configured the endpoint answers 403, exactly like the exchange, and the app
points at Verwaltung › System › Anbindungen.

```
alert text …  https://front.example.org/l/<token>
                       │  responder taps it
                       ▼
       POST /api/incident-link/session  { token }   → sets the link_session cookie
                       │
                       ▼
       the app opens on that incident, read-only
```

`/l/<token>` mirrors the poster's `/e/<token>`. The token is minted **by the alerting system,
offline** – KP Front is never called to issue it. That is a requirement, not a convenience: the
alerting system sits on the life-critical path and must not acquire a runtime dependency on this
app being reachable.

### Minting the token

A JWT signed **HS256 with the station's `incident_link_key`**, naming the incident the way the
sender already knows it:

The key generated by current releases contains 256 bits of entropy, matching RFC 7518 §3.2.
Keys minted by older releases remain valid so an upgrade does not silently break the alerting
system; rotate and copy the new value during the next planned integration maintenance window.

| Claim | Value |
| --- | --- |
| `type` | `"incident-link"` – nothing else is accepted, so a credential minted for another purpose can never become a link session |
| `src` | the same `source` slug the sender uses for `POST /api/alarms` (`leitstelle`, `divera`, …) |
| `ref` | the sender's own alarm id – the `source_id` from the intake, or the Divera alarm id |
| `exp` | standard JWT expiry; checked on exchange |

`src` + `ref` are exactly the pair the intake deduplicates on (`Incident.source` /
`source_ref`), and that is what keeps this provider-neutral: **an alerting system never has to
learn KP Front's incident UUIDs** – it links to the alarm it already sent.

A link whose alarm is still sitting in an intake pool **opens it** (2026-08-02). Before that,
the responder holding the link waited on a colleague opening the alarm on a tablet and saw
«Einsatz nicht (mehr) verfügbar» until they did – the link was only as fast as the slowest
person at the Magazin. Opening grants nothing extra: the session that follows is the same
read-only viewer, and the incident stays *unconfirmed* until an editor works it, so a link
tapped for a turnout that never happened never reaches the statistics. Still send the intake
(§1) before or with the alert: an alarm neither the incident table nor any pool knows answers
«nicht (mehr) verfügbar», and works on the next tap.

```python
# in the alerting system, at alarm time — no call to KP Front
import jwt, time
token = jwt.encode(
    {"type": "incident-link", "src": "leitstelle", "ref": "E-2026-0815",
     "exp": int(time.time()) + 12 * 3600},
    INCIDENT_LINK_KEY, algorithm="HS256",
)
alert_text += f"\nLage: https://front.example.org/l/{token}"
```

### Two keys, deliberately

| Key | Held by | Signs | Managed |
| --- | --- | --- | --- |
| `incident_link_key` | the station **and** its alerting system | the inbound link token | DB row, admin UI (read / rotate / delete) |
| `SECRET_KEY` | KP Front alone – it never leaves the app | the resulting `link_session` cookie | env var, deploy time |

The station key can do exactly one thing: ask for a link session. It is deliberately **not**
`SECRET_KEY`, and that separation is the point – `SECRET_KEY` peppers every PIN and mints admin
sessions, so an alerting system holding it could issue itself deployment-admin access without
ever knowing `ADMIN_SECRET`.

KP Front generates the key; the admin copies it into the alerting system (admin UI: System ›
Anbindungen, the «Von KP Front erzeugt» sheet – enable/rotate/delete). Three admin endpoints
(`ADMIN_SECRET` session, not the editor role – handing this key out grants read sessions on every
incident the station will ever have): `GET /api/incident-link/secret` shows the current one,
`POST /api/incident-link/secret/rotate` mints a fresh one, `DELETE /api/incident-link/secret`
turns the surface off.

**Fail-closed:** no `incident_link_key` configured → `POST /api/incident-link/session` answers
`403` and there is no link surface at all. Minting the key is the opt-in – an upgrade adds the
column as `NULL` and therefore changes nothing until a station acts. Rotating or deleting it
invalidates every link already sent out, so a rotation and reconfiguring the alerting system are
one operation, not two.

### What the link reaches – and what it deliberately cannot do

The reachable surface is an **allowlist**, not a blocklist. There are roughly 40 routes a
`viewer` may call today; a blocklist would silently grant every route added after this control
was written, and surviving future edits is the one thing it has to do.

On the list – the incident itself (Stammdaten, workspace/Lage + Plan, Personen, Notizen,
Verlauf, Ereignisse, Snapshot, Status), the station reference data without which the map is
useless (Objekte und Objektpläne, Referenz-Layer wie Hydranten, Personal, Medien), the
deployment config and branding, and two pieces of **live display data**: vehicle positions and
trails, and weather. Those two are the only outbound calls allowed, and they are in on purpose –
they carry no personal data, and leaving them out would make the link visibly poorer than the
`viewer` account it is meant to mirror.

Off the list, each for a stated reason:

| Refused | Why |
| --- | --- |
| Einsatzrapport / Zeitplan **PDF** | generates a document carrying attendance and names |
| Rapport / Zeitplan **print**, print-job cancel | makes the station's printer print, or kills someone else's job, from a forwarded URL |
| Push subscriptions | writes rows tied to a user |
| Geocoding, Overpass | billable third-party calls, and an open proxy |
| `media/*/peaks`, `media/*/transcription` | `GET`s that are not reads – they write a file or mutate a job row |
| Diagnostics export | the station's own crash traces are internal diagnostics, and a link is handed to outsiders |
| Everything that writes | a link is a read surface, full stop |

**Scope is enforced twice.** Being allowlisted is not enough: a route that names an incident
must name *the* incident the token was minted for, or a link to one Einsatz reads every other
one. There is no incident list and no roster login behind a link.

**Every refusal looks the same.** Inside a link session, every route that is not allowed is one
`403` with one message – a link holder must not be able to tell "that route exists but you may
not have it" from "no such route", because the difference is a map of the API drawn by probing.
The exchange answers the same way: any unusable token is `401` (bad signature, wrong type,
missing claims and expiry are all just "this link doesn't work"), and unknown, closed and
archived incidents are one `404`, so a link cannot be used to find out which Einsätze the
station has.

**A link is the literal page, and nothing on the device.** Opening one never changes what that
browser is signed in as, and a login on that browser never changes what the link page shows.
The link session's cookie is site-wide (an `<img src="/api/media/…">` cannot carry a header), so
the *page* says which session it is asking with, on every request – `X-Incident-Link: off` from
the ordinary app and `/admin`, `use` from the handed-over Atemschutz board, and nothing at all
from a subresource or an alarm/view link page, where a real login still wins. So: the bare site
after a link visit is whoever it was before, an Atemschutz link opens the board even on a phone
that is signed in (it used to log that phone out first), and nothing inside a link session can
end a session on the device – `POST /api/auth/logout` is deliberately off the allowlist.

The one direction that stays coupled is **«Abmelden» on the device**: it clears the link cookie
along with the login. Not because the app reads that cookie – it says `off` and never does – but
because the requests the browser makes with *no* header of ours (a typed address, an `<img>`, the
service worker) still answer as the link guest for the rest of the 12 h TTL, and «Abmelden» is
the one gesture that means «I am done on this device». A link page loses nothing by it: it has no
«Abmelden», and its token is still standing in its own address bar.
`GET /api/auth/me` reports `link_scoped` and `link_incident_id` for a link session, so the app
can hide the controls that would 403 instead of showing dead buttons.

**Lifetime: until the Einsatz is closed, and at most 12 h.** The incident is re-checked on
*every* request a link session makes, not only at exchange – so closing or archiving the Einsatz
revokes every link to it immediately, on the phones that already have it open, with no admin
action needed. `incident_link_session_ttl` (12 h by default) is only the backstop for the
incident nobody ever closes. That is also why the key rotation above is for *revoking early*,
not for routine hygiene.

The one exemption is the SPA fallback route: the app shell keeps being served after the link
dies, so a responder gets KP Front's own "nicht mehr verfügbar" screen instead of a bare JSON
`403` where the HTML should be.

Trust model: **the URL is the credential** – possession of the alert, the same authority as
knowing the Einsatz happened at all. It travels to personal phones and can be forwarded, so read
it as "everyone who receives the alert may see this Einsatz until it is closed", including the
station roster, who is on the Einsatz and what the Verlauf says. Weigh that where a station's
data-protection notes live ([`PRIVACY.md`](../PRIVACY.md)); if it does not hold for a
deployment, leave `incident_link_key` unset and the surface does not exist.

## 5. Standing links: Stations-Terminal & fixe Atemschutz-URL

Two station-level variants of the Einsatz-Link (2026-09-09), for people *inside* the station
who should not need an alert message, a login or a colleague to mint anything. Their secret
lives on the deployment row, not on an incident, and the URL names no Einsatz – the exchange
resolves **whichever Einsatz is currently open** (Übungen included). Exactly one open → the
session binds to it; none → a calm «Kein laufender Einsatz» screen that keeps polling; more
than one → a chooser. Everything after the exchange is an ordinary one-incident link session:
same allowlist, same double scope check, same per-request liveness.

- **Stations-Terminal** (`/l/t<secret>` → `/terminal`): a depot PC enrolled once. The
  enrollment link is opened a single time on the device and leaves a long-lived httpOnly
  device cookie carrying a key *fingerprint* – the secret itself never persists on the device,
  not even in a bookmark (the page rewrites itself to `/terminal`). From then on the screen is
  simply right when an alarm comes in. Read-only, the alarm link's exact surface.
- **Fixe Atemschutz-URL** (`/l/s<secret>`): a laminated QR on the Überwachungstafel. Opens the
  Atemschutzüberwachung of the running Einsatz with the Atemschutz link's exact write slice
  (trupps, `team` journal rows, `atemschutz.*` events), stamped `atemschutz-fix` so the
  record says which credential wrote. It complements the per-incident Atemschutz-Link; it does
  not replace it.

Both are managed at `/admin` → System › Links & Zugänge, each on its own key
(`terminal_link_key`, `atemschutz_standing_key`), so rotating one never touches the other –
or the alerting system's minting key. Rotation is the revocation and it is total: the printed
QR, every enrolled device and every session already open die on their next request. Unset =
the surface does not exist (fail-closed, like everything above).

Trust model: **physical presence at the station** – possession of the laminated card or of
the enrolled machine. That is why these two (and only these two) may see the list of open
Einsätze in the chooser, and why the standing Atemschutz writes are proportionate: the same
person could reach the paper board on the same wall.

## Security notes

- All four secrets are independent and fail-closed: the alarm webhook secret (inbound), the
  poster token (capture), `incident_link_key` (Einsatz-Link), `ADMIN_SECRET` (administration).
  Three of the four are managed in the browser and stored in the database – the alarm webhook
  secret at `/admin` → **Anbindungen** (encrypted; `ALARM_WEBHOOK_SECRET` in `.env` outranks and
  locks it), the poster token under System › **Links & Zugänge** and `incident_link_key` under
  System › **Anbindungen** (it is a signing key, not an address).
  **Only `ADMIN_SECRET` is env-only**, and deliberately so: it gates writing the
  very document it would otherwise live in.
- Outbound webhook URLs are admin-set config, pinned to `http(s)`, and `GET /api/config` serves
  them to an admin session only (22.10.2026 – a URL with a `sig=` or `?secret=` is a capability);
  the payload contains the capture URL (a capability) – point webhooks only at receivers you
  trust.
- The capture surface reaches unarchived incidents without a completed Rapport at **any**
  age (the open backlog), plus anything inside `alarms.captureWindowHours` regardless of
  report state — and only attendance/material/journal/Einsatzende/Beilagen. The workspace
  endpoints are key-scoped to `attendance`, `mittel`, `reportMeta` and `attachments`
  (`CAPTURE_WORKSPACE_KEYS` in `backend/app/api/capture.py`): the tactical map is neither
  readable nor writable with a poster token, and a capture save merges over the server's copy
  so it cannot clobber it. `attachments` (Rapport-Beilagen, added 2026-08-06) comes with one
  write route for the bytes — `POST /api/capture/incidents/{id}/media`, **photos only**, one
  reachable incident, the same content-type allowlist and size cap as the editor upload, behind
  the same per-IP capture rate limit. A Beilage is report paperwork, which is what the poster
  is for; audio is deliberately not offered there.
- A link token exposes **one incident, read-only, for as long as that incident is open** (the
  Atemschutz-Link above is the single, narrow exception): map,
  Pläne, Referenz-Layer, Personen, Verlauf and the live vehicle/weather display — what a
  `viewer` sees on screen, and nothing that writes, prints, generates a PDF or calls a paid
  service. The reachable routes are an allowlist (`LINK_ALLOWED` in
  `backend/app/auth/incident_link.py`), and every one of them that names an incident is
  additionally checked against the token's own incident, so a link to one Einsatz cannot read
  another. It lasts **until the Einsatz is closed, and at most 12 h**: the incident's state is
  re-checked on every request, so closing or archiving it revokes the link on phones that
  already have it open, and `incident_link_session_ttl` is only the backstop for an Einsatz
  nobody closes. Rotating `incident_link_key` invalidates every outstanding link at once.
