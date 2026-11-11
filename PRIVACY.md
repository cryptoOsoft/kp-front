# Privacy

KP Front is self-hosted. Your incident data, roster, map cache and media live on **your** server;
the app does not send operational records to the maintainer. There is no cloud account, licence
check, usage beacon or "phone home" on start-up. Map/location lookups and integrations that a
station explicitly configures can contact their named providers, as documented below.

This document covers the one exception: how a station can *choose* to send something to the
maintainer. **The app has no upstream destination at all** — the maintainer's ingest server was
retired in September 2026, and the code that could forward crash reports to one was removed in
November 2026. The only way something reaches us is that a person exports it and attaches it to
an e-mail or an issue. You can verify that with `tcpdump`.

Separately, and unrelated to any installation, the project's public website has a contact form.
That is a website, not the app — see [The project website](#the-project-website) at the end.

## Map and address services are a separate matter

Nothing above is about the **map**. Drawing a map means asking somebody for map data, and most
of those requests carry a location:

| Service | What leaves | Who it goes to | Turn it off |
|---|---|---|---|
| Basemap tiles | the map tiles you are looking at, i.e. roughly where you are working | the configured tile provider, **from the browser** (so it can cache them) | choose a different `map.bases` entry, or self-host tiles |
| Basemap tiles for printed PDFs | the tiles around the incident, to draw the map on the Rapport and the Tafel print | the same provider (Carto, OpenStreetMap or swisstopo, or a host listed in `REPORT_TILE_HOSTS`), **from the server**; cached on disk | a basemap whose host is in neither list prints a grey background instead – self-host tiles and list that host to keep the map |
| Building outlines («Umrisse») | a bounding box around the incident | public [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) mirrors, **from the server** | `OVERPASS_MIRRORS=` (empty disables the surface) or point it at your own Overpass |
| A station object's buildings («Karte & Objekte») | the coordinate of a station object (never an incident's), once per object, and a box around its parcel | swisstopo's vector tiles (vectortiles.geo.admin.ch), the geocoder host (parcel) and geodienste.ch's open cadastral-survey WFS, **from the server** (scheduler) | `FOOTPRINT_AREA_TILES=` or `FOOTPRINT_BUILDINGS_WFS=` (either empty switches it off; the map then draws the OSM building the object's point lies in) |
| The Einsatzgebiet's houses and underground buildings («Karte & Objekte»: a building tap, «Unterirdische Bauten») | the municipality numbers, the map centre and a box around every station object — never an incident's coordinate; weekly | swisstopo's municipality boundaries (the geocoder host) and geodienste.ch's open cadastral-survey WFS, **from the server** (scheduler) | `HOUSES_WFS=` / `UNDERGROUND_WFS=` (empty switches each off; a building tap then opens the OSM outline) |
| Address search / geocoding, Gebäude-Steckbrief | the text you type, a clicked coordinate, or the incident point for the federal building registers (GWR, BFE) | the configured geocoder host (swisstopo's geo.admin.ch by default), **from the server** | `GEOCODER_URL` |
| Höhenprofil (Messen › Strecke, a Leitung, Wassertransport) | the points of the line you drew or measured, as LV95 coordinates | swisstopo's elevation service (`api3.geo.admin.ch`), **from the browser** – the one lookup that is not proxied by the server | no switch – it is asked only for a measured Strecke or a Leitung whose profile or pressure the app works out; without an answer the line shows its distance only and a Wassertransport is calculated without slope |
| Weather layer (radar) | nothing about you: the backend downloads the nationwide MeteoSwiss radar files | [MeteoSwiss open data](https://opendatadocs.meteoswiss.ch/), **from the server** | `WEATHER_LAYER_ENABLED=false` |
| Weather / wind | the incident coordinate for the point-based weather code and fallback; MeteoSwiss observation downloads themselves are national, not point queries | [Open-Meteo](https://open-meteo.com/), **from the server** | `OPEN_METEO_URL=` (empty disables weather) |

These are ordinary third-party services, not a channel to the maintainer, and none of them
receives names, roster, attendance or journal text — only a location. The shipped Overpass
mirror list includes one host in Russia (`maps.mail.ru`, a long-standing public mirror); a
station that would rather not use it sets `OVERPASS_MIRRORS` to the other two.

## Forms your own Wehr links from the Rapport

A station can put its own paperwork on the Rapport as a list of links – the Getränkeabrechnung
for the Gemeinde, a Schadenmeldung, an internal form (`report.links`, see
[`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) §1d). **Nothing here is on by default:** a
deployment that configures no links has no such section, and this whole page does not apply to
it.

Where a station does configure one, two things are worth being deliberate about:

- **A link can carry incident data to whoever hosts the form.** The URL may contain placeholders
  the app fills in when the link is opened, and those include the incident address, the
  Einsatzleiter and Kontaktperson by name, and the free-text Kurzbericht – which in this line of
  work often describes what was found at an address. That data travels **in the URL**, from the
  browser, to the form's host: its logs, and the device's own browser history. If the form is a
  Google Form, the host is Google. The app opens the link with `noreferrer`, which is beside the
  point here – the data is the address being requested, not the referrer.
- **The configured links are readable by everyone who can sign in.** They are withheld from
  anonymous callers of the app's otherwise-public `/api/config`, but any PIN session can read
  them – which is right, because the Rapport that shows them is behind the same PIN. So this is
  not a secret store: a form id is a capability, whoever knows it can submit to that form, and it
  lands in the browser history of every device that opens it. Do not put a token, key or secret
  path in a link, and prefer a form your own organisation restricts over one that is open to
  whoever has the address.

Neither of these sends anything to the maintainer — this is your Wehr's own configuration talking to your Wehr's own choice of form
provider. It is documented at this length because a link can carry incident text off the
instance without an operator realising it. The other optional integrations that can carry
incident data are listed in the next section.

## Optional integrations a station connects

Each of these is off until the station configures it, each talks to a destination the station
chose, and none of them sends anything to the maintainer. Requests go from the server unless
noted.

| Integration | What leaves | Who it goes to | Turn it off |
|---|---|---|---|
| Incident webhooks | when an Einsatz opens: its title, type, priority, address, coordinates, alarm source and id, start time and – if `PUBLIC_URL` is set – its `/e/<token>` capture link, which opens that Einsatz's capture page for whoever holds it; when an alarm is attached to an Einsatz: the Einsatz id and title and the alarm's source and id | every URL in `alarms.webhooks`, without an auth header | leave `alarms.webhooks` empty |
| Web Push | the notification's title and text – e.g. «Neuer Einsatz» with title and address, an Atemschutz alert naming the Trupp, a Wiedervorlage's text, an Objektbesuch summary with names – encrypted to the subscribed browser's own keys | the push service of each subscribed browser's vendor (e.g. Google, Mozilla, Apple), which relays it without being able to read it, but sees when and to which subscription | leave the `VAPID_*` keys unset |
| Speech-to-text | the audio of one recording, when an editor taps «Transkribieren» | the server at `STT_BASE_URL` (OpenAI, Groq, or self-hosted) | leave `STT_BASE_URL` empty |
| Objektbesuche filing | each visit's full record (object, who visited, checklist answers, Bemerkungen, Korrekturvorschläge) as PDF and JSON, plus its photos – one way, nothing deleted remotely | the station's own SharePoint folder via Microsoft Graph, under a separate app registration | disable the destination in `objectVisits`, or leave `SHAREPOINT_EXPORT_*` unset |
| Einsatz-Ablage | a closed Einsatz's photos, Sprachnotizen and Beilagen as stored, and its newest Rapport-PDF (names, Anwesenheit, Verlauf – everything the Rapport prints) – one way, nothing deleted remotely; while it is on, the server keeps that one PDF per Einsatz | the station's own SharePoint folders via Microsoft Graph, under the same separate app registration as the Objektbesuche | leave `incidentArchive.enabled` off (the default), or leave `SHAREPOINT_EXPORT_*` unset |
| SharePoint pull | only the requests for the configured folders – read-only, nothing is written | the station's own Microsoft 365 tenant via Graph | empty `sharepoint.sources`, or clear the `SHAREPOINT_*` credentials |
| «Mit Microsoft anmelden» | the person signing in is sent to Microsoft by their browser; the server redeems the one-time code with the app's client credentials and fetches Microsoft's signing keys | the station's Entra ID tenant | leave the `ENTRA_LOGIN_*` credentials unset |
| Divera 24/7 | the station's access key with each read of alarms, answers and roster; nothing is written back | Divera | leave `DIVERA_ACCESS_KEY` empty |
| Traccar | the station's Traccar login; vehicle positions are only read | the station's Traccar server | leave `TRACCAR_URL` empty |
| Station-data sources | the station's own read credential, if any; nothing is written | the configured S3 plan bucket, station index or roster snapshot | leave the `PLANS_S3_*`, `STATION_INDEX_SOURCE` and `ROSTER_SNAPSHOT_SOURCE` settings empty |
| Heartbeat | a bare GET every 60 s, with no content | the monitor at `HEALTHCHECK_PING_URL` | leave it empty |

## Sharing your own location during an Einsatz

One feature has a person's phone report where that person is: **Standort teilen**. It exists so
the command post can see where the crew is working — someone sent on a Wassertransport or a
Zubringerleitung is kilometres away on purpose, and the alternative is phoning around to find
out. It is not attendance control, and nothing in the app flags, warns about or scores distance.

It stays on your own server: the position goes to the same backend that serves the app and
nowhere else. Beyond that, the rules are deliberately narrow.

| | |
|---|---|
| Who decides | The person holding the phone. Nobody can switch it on for somebody else. |
| How | Asked once per device — agree, pick your own name from the roster, and it resumes automatically at later Einsätze until you switch it off. Declining is remembered too. |
| When | Only while an Einsatz is open, and only while the app is actually in the foreground. A locked phone reports nothing; the last position simply ages, and the command post sees how old it is. |
| Who sees it | Signed-in editor and viewer accounts — the command post. Someone who merely tapped the Einsatz-Link on their own phone can *send* their position and can read **nobody else's**. This is enforced server-side, not in the UI. |
| What is stored | One row per person per Einsatz: name, coordinates, accuracy, time. It is overwritten on every update, so no track of anyone's movements is ever built. |
| How long | Until the Einsatz is closed, which deletes it. A position that goes untouched is swept anyway (`POSITION_TTL_HOURS`, default 6). Stopping deletes it at once. |
| Where it does *not* appear | The Verlauf, the audit trail, the Einsatzrapport, the statistics export. It is display data, not part of the record. |
| Public demo | Off entirely. |

Turning off sharing on the phone removes the position immediately — it does not merely stop
updating it.

## Divera answers («Anrückend»)

On a station connected to Divera 24/7, the Anwesenheit shows who answered the alarm «kommt» or
«kommt nicht», so the command post knows who is still on the way
([`docs/divera-connector.md`](docs/divera-connector.md) › Rückmeldungen). An answer is never
attendance: nobody is marked present because of it.

| | |
|---|---|
| Where it comes from | The station's own Divera account, read by the station's own server, the same way the alarm itself is. Nothing is written back to Divera. |
| What is stored | Per alarm: which people on the station's own Mannschaftsliste said «kommt» and which «kommt nicht», and how many answers came from people not on the list. **Nothing else.** It keeps no Divera user id, no answer time, no status wording, no free-text note, and no record of who was alerted or who read the alarm. Answers that are neither yes nor no are dropped. |
| Who sees it | Signed-in editor and EL accounts, and only for an Einsatz that is still open. Viewer accounts and anyone on an Einsatz-Link see nothing. |
| How long | The answers count for «Anrückend» for 6 hours after the alarm. They are **deleted** once the Einsatz is closed, and in any case 48 hours after the alarm, even if Divera has since been disconnected. The alarm itself stays in the intake history. |
| Where it does *not* appear | The Verlauf, the audit trail, the Einsatzrapport, the statistics export, or the workspace that syncs to devices. A device keeps the last answers it saw in memory while the app is open, never on disk. |

Everything below is about the maintainer channels.

## Signing the Einsatzrapport on the screen

The Rapport can be signed with a finger on the screen. What is kept is the **shape** of the
strokes – a picture of the signature, as on paper. The app does **not** record how fast or how
hard the line was drawn, so it holds no biometric data. The signature is stored with the Einsatz
on your own server, with the signer's name and the time, and printed on the Rapport. It is never
sent anywhere else.

## The short version

| | Diagnostics export («Diagnose-Datei») |
| --- | --- |
| Who starts it | An operator, in the **Rückmeldung** sheet |
| Consent | Saving the file and attaching it |
| Content | This server's sanitised crash traces since its last restart |
| Where it goes | Wherever the operator sends it — an e-mail, a GitHub issue — and nowhere else |

There is no background channel. The app used to be able to forward sanitised crash reports to
an ingest (off by default, and aimed at nothing since the maintainer's ingest was retired); that
forwarder, its consent setting, its install id and its outbox table were removed in November
2026, together with `KP_TELEMETRY_ENABLED` and `KP_TELEMETRY_DSN`. A leftover line in an `.env`
is ignored.

## What the file contains

| Field | Example | Why |
| --- | --- | --- |
| `app` | `kp-front` | Which of the two apps |
| `release` | `0.2.0+a1b2c3d` | The single most useful field in any bug report |
| `device` | `iPad Safari` | A rendering bug is usually a browser bug |
| `errors` | up to 50 entries | The crashes this server has seen since its last restart |

Each crash entry carries the time, the exception type, a scrubbed message, a stack reduced to
function names and module basenames, the route shape, and the release and device class it
happened on. Whatever the operator types goes in the mail or the issue, in their own words,
where they can read it before sending.

## What is never in it

Not "we try not to include" — these are constructed out of the entries and asserted by tests
(`backend/tests/test_telemetry_scrub.py`):

- **Incident data of any kind**: addresses, coordinates (WGS84 *and* LV95), incident IDs, object
  names, journal text, drawings, audio, plan files. No incident medium is ever read by this code.
- **People**: roster names, functions, phone numbers, e-mail addresses, Divera identities, PINs.
- **Your instance**: hostname, station name, deployment config, database contents, file paths,
  usernames, environment variables, tokens, secrets.
- **Network identity**: no IP address and no raw user agent.
- **Screenshots and photos.** There is no code path that captures a screen. If a photo helps,
  you attach it to your own mail or issue, where you can see exactly what you are attaching.

Every entry is built by an **allow-list**: every field is named in
`backend/app/telemetry/scrub.py` and the caller's object is never passed on, merged or spread.
A field nobody wrote a line of code for cannot leak. Free text is additionally scrubbed, because
the value is often *inside* the message — `TypeError … at Hauptstrasse 12` is a real shape.

## How to check, rather than trust

**The diagnostics file itself.** It is plain JSON, it is on your device, and it is the exact
thing that would be attached — open it before you send it. The Rückmeldung sheet also shows
the technical block and the number of crash entries the file holds, before you decide.

## Where it goes

**Nowhere on its own.** A crash is written to your server's log and held in a small in-memory
buffer on your server (`backend/app/telemetry/recent.py`, the last 50, cleared on restart).
Both copies are yours, and neither moves on its own. Nothing about it is stored in the database.

## Getting a bug report to the maintainer

Since nothing travels on its own, the route is deliberate and manual:

1. In the app, open **Rückmeldung** (Einstellungen, or the prompt after a crash).
2. Read the technical block. It is shown in full, before you decide anything.
3. Save the **Diagnose-Datei** — the sanitised crash traces from your server's buffer. This is
   the part that makes a report actionable; without it a bug report is a sentence.
4. Attach it to an e-mail (`bastian.eichenberger@feuerwehr-oberwil.ch`) or to a
   [GitHub issue](https://github.com/feuerwehr-oberwil/kp-front/issues/new?template=bug_report.yml).

You can open the file first — it is JSON, and it is the same content the app showed you.

## The IP question

The app makes no request to the maintainer from which an address could be read.

The manual routes are ordinary ones with the ordinary consequences: an e-mail carries your mail
provider's headers, and a GitHub issue is public and tied to your GitHub account. Both are
visible to you before you press send, which is the point of doing it this way.

## The project website

`kp-front.ch` is the project's landing page. It is **not** part of the software and has nothing
to do with your installation: it is a handful of static files on GitHub Pages. It makes exactly
two requests to anything of ours — a visit count (below) and, if you submit it, the contact form
— and it never talks to a station's server.

The appearance control stores only your explicit light/dark choice in localStorage under
`kp-landing-theme`. It stays in your browser, applies across the site's language pages, and
is not sent with the visitor counter or contact form. Without a saved choice the page follows
your device appearance; blocked browser storage does not prevent switching themes.

It carries one contact form (name, e-mail, message). Submitting it sends those three fields to
**staticforms.dev**, which forwards them to the maintainer by e-mail. Static hosting cannot
accept a form post, so a third party does that step. The service therefore processes what you
type, plus the usual request metadata a web server sees (including your IP address); its own
terms and retention apply, and we have no agreement with it beyond an ordinary account.

Three things follow, and they are the point of this section:

- **Using the form is entirely optional.** `bastian.eichenberger@feuerwehr-oberwil.ch` reaches the same person
  without a third party in between. The form exists because a `mailto:` link does nothing on a
  duty phone with no mail client configured — not because we prefer it.
- **It is a website visitor's data, never a station's.** No incident data, roster, or anything
  from a running instance is involved. A deployed KP Front never contacts this service.
- **Self-hosters are unaffected.** The landing page is not shipped in the Docker image and is not
  served by the app. If you host this software, none of the above applies to your deployment.

### Counting visitors without recognising them

We want to know two things: whether anybody reads the landing page, and which parts of the
public demo at `demo.kp-front.ch` people actually try. Both are counted by our own backend —
there is no analytics provider, no tracking script and no consent banner, because there is
nothing here to consent to.

**How.** Opening a page sends one small request to the demo server naming which page it was
(the language, or «404»). Inside the demo, switching to a section — Lage, Plan, Checklisten,
Atemschutz, Anwesenheit, Mittel, Rapport — sends the section's name the same way. That is the
entire payload: no identifier, no cookie, nothing written to your browser's storage, nothing
about what is on the screen.

**What is stored.** Counters, and only counters: one row per day, per kind, per name, holding
a number of visits and a number of visitors. There is no table of individual visits anywhere
in the design, so «what did this person look at» is not a question the database can answer —
not for us, and not for anyone who obtains it.

**How visitors are counted without a cookie.** Your IP address and browser string are hashed
together with a secret salt that is derived fresh for each calendar day and never written
down. The hash decides whether you have already been counted *today*, and then that is all it
can ever do: tomorrow's salt is a different one, and yesterday's no longer exists, so two days'
records cannot be linked — by us or by anybody else. The IP address itself is never stored and
never logged.

**Referrers.** If you followed a link here, we count the *hostname* it came from, so we can see
where people hear about the project. The path and query string of that address stay in your
browser.

**On your own installation this is switched off, permanently.** Your deployment runs the same
code, but the counters need `VISIT_STATS=true`, which is set on the public demo and nowhere
else — unset means nothing is counted at all, not that counting happens locally. The landing
page's request goes to the demo host, so a station's server is not involved in it either.

The mechanism is [`backend/app/visits.py`](backend/app/visits.py) and the browser's half is the
short block at the bottom of [`site/index.template.html`](site/index.template.html) — read those
rather than believing this section.

## Legal

Your fire service is the data controller for everything in its instance. Nothing is sent to the
maintainer by the software; a Diagnose-Datei reaches us only when a person at the station
decides to attach it.

Questions, or a deletion request: **bastian.eichenberger@feuerwehr-oberwil.ch**.
