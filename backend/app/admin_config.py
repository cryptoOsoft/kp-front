"""Admin CLI for the deployment-config singleton row (id=1) — config-as-code.

A single kp-front build serves many fire-brigade deployments; each one's per-station
config (identity/map/referenceLayers/fleet/symbols/doctrine/roster/mittel) lives in the
``deployment_config`` singleton row and is served to the frontend by the PUBLIC
``GET /api/config`` (see app/api/config.py). This command is how an admin (or an agent)
authors, validates, and applies that config from a JSON file — against whatever
``DATABASE_URL`` points at (the local dev Postgres from ``just db`` by default; export a
different ``DATABASE_URL`` to target another deployment). kp-front is Postgres-only; there
is no database file to go looking for.

Designed to be driven by an LLM/agent: the loop is

    schema → (author config.json) → validate → diff → load

Usage (from the ``backend/`` directory, via ``uv run python -m app.admin_config <cmd>``):

    schema              print the JSON Schema of the config document (the contract)
    example             print a populated example config you can edit
    validate <file>     parse + validate a file (no DB needed, nothing written)
    diff <file>         show what would change vs the currently-stored config
    load <file>         validate + upsert the file into the row (writes to the DB)
    load <file> --dry-run   same as ``validate`` (no write)
    show                print the currently-stored config

Back-compat: ``app.admin_config <file.json>`` (bare path) still means ``load``, and
``--show`` / no args still means ``show``.

Behaviour:
- Files are validated through ``DeploymentConfigIn`` — the SAME schema the ``PUT /api/config``
  endpoint uses. Invalid JSON or a schema failure prints precise ``field.path: message`` lines
  and exits non-zero; nothing is written.
- ``load`` persists the NORMALIZED document (defaults filled in) as ``config_json`` so GET
  round-trips consistently. Idempotent; ``updated_by`` is left NULL (out-of-band admin load,
  not a logged-in editor PUT).
- ``schema``/``example``/``validate`` need NO database connection (``diff`` reads the stored row).
- Every model is ``extra="ignore"`` — which keeps an old deployment able to read a new file, and
  makes a typo indistinguishable from an intent. So ``validate``/``load``/``push`` name the keys
  the schema DROPPED, with a did-you-mean: «ignored: identitiy — did you mean identity?».
- ``alarmKeywords`` — the station's own alarm vocabulary — is the one block that replaces a
  shipped default rather than filling in a blank, so validate/diff/load each print a line
  naming which vocabulary the file puts in charge. It is NOT in ``example``: the shipped
  ``app/data/alarm_keywords.json`` is the right answer for nearly every station, and a
  station that needs its own starts from a copy of that file (see docs/CONFIGURATION.md §1a).

Writes lock and reload the singleton before preserving history, so another accepted write
cannot disappear from both the live document and its recovery history.
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select

from .admin_cli import add_push_args, admin_client, fail, require_push_target
from .config_guard import (
    RESPONSE_ONLY_FIELDS,
    carry_runtime_sections,
    emptied_declared_sections,
    format_validation_errors,
    ignored_keys,
    layer_warnings,
)
from .config_history import keep_previous
from .database import async_session_maker
from .deployment_config import config_row
from .models import DeploymentConfig, DeploymentConfigHistory
from .ranks import SWISS_DEFAULT_RANKS
from .schemas import DeploymentConfigIn

# A representative, schema-valid example. Mirrors CONFIGURATION.md §1; edit to taste.
EXAMPLE_CONFIG: dict[str, Any] = {
    "identity": {
        "appName": "Feuerwehr Musterdorf",
        "shortName": "FWM",
        "locale": "de-CH",
        "accentColor": "#c4161c",
        "helpIntro": "Digitale Lage- und Einsatzführung der Feuerwehr Musterdorf.",
        "kommandant": "Maj Hans Muster",
    },
    "map": {
        "defaultView": {"center": [7.5662, 47.5201], "zoom": 16},
        "geocoder": {
            "defaultLocality": "4104 Musterdorf BL",
            "bboxLv95": "2606000,1258000,2614000,1266000",
        },
    },
    # ⚠️ NO `referenceLayers` here, deliberately. It is the one section a config FILE must never
    # carry: the layers are written at RUNTIME by `admin_geodata` (see config_guard ·
    # RUNTIME_SECTIONS), and they are only carried over when the incoming file is SILENT about
    # them. An example block left in the file therefore REPLACES a station's real hydrants on
    # every push — and because the section then has content, neither `emptied_sections` nor
    # `carry_runtime_sections` says a word. Reference layers are authored in a geodata manifest,
    # not here.
    #
    # Objektplan modules: tile label/order (M1, 2/3, …) + the importer's filename parsing rule
    # (`match` regex). `combinedWith` = a combined sheet that fills several slots; `family` =
    # generative (the `match` capture becomes a sub-slot, e.g. "Modul 5 - Wasser" → modul5-wasser).
    #
    # ⚠️ `match` is IMPORTER-ONLY. Nothing in this repo reads it: the app derives its plan tiles
    # from id/code/title/order/viewer alone (src/lib/deploymentConfig · modulesFromConfig), and
    # the regex is consumed by the private `scripts/import_einsatzplaene.py` when it decides which
    # module a scanned PDF's FILENAME belongs to. A station that imports its Objektpläne by hand
    # can leave every `match` exactly as it stands here.
    #
    # `alignment` = how a module's sheets get onto the Karte: "auto" (the server proposes, the
    # admin approves on Objektpläne › Plan-Ausrichtung, the field can ask for a proposal),
    # "manual" (reference points by hand only) or "none" (never on the map). Unset means auto
    # for modul1/modul2/modul2-3 and none for everything else – spelled out below so a station
    # sees what it opted into.
    "modules": [
        {
            "id": "modul1",
            "code": "M1",
            "title": "Übersicht",
            "order": 1,
            "orientation": "portrait",
            "match": r"modul\s*1(?!\s*[-–/]\s*\d)",
            "alignment": "auto",
        },
        {
            "id": "modul2",
            "code": "M2",
            "title": "Umgebung",
            "order": 2,
            "match": r"modul\s*2(?!\s*[-–/]\s*\d)",
            "alignment": "auto",
        },
        {"id": "modul3", "code": "M3", "title": "Objektplan", "order": 3, "match": r"modul\s*3(?!\s*[-–/]\s*\d)"},
        {
            "id": "modul2-3",
            "code": "2/3",
            "title": "Umgebung & Objekt",
            "order": 4,
            "match": r"modul\s*2\s*[-–/]\s*3",
            "combinedWith": ["modul2", "modul3"],
            "alignment": "auto",
        },
        {
            "id": "modul6",
            "code": "M6",
            "title": "Gebäudepläne",
            "order": 6,
            "orientation": "portrait",
            # Modul 6 = Geschosspläne: a reference PDF you SCROLL, not annotate — building
            # annotation lives on the interactive Gebäude floor-stack. The frontend fallback
            # (lib/deploymentConfig · DEFAULT_MODULES) has said `viewer: true` all along and the
            # in-app help states it as a fact; this template did not, so a station seeded from
            # HERE got a drawable Modul 6 and the help was wrong about it.
            "viewer": True,
            "match": r"modul\s*6",
        },
        {
            "id": "modul5",
            "code": "M5",
            "title": "Spezialpläne",
            "order": 5,
            "family": True,
            # ⚠️ The sub-slot capture takes a TRAILING NUMBER, so «Modul 5 - Wasser 1» and
            # «Modul 5 - Wasser 2» are two plans rather than one overwriting the other. Must stay
            # identical to DEFAULT_MODULES in src/lib/deploymentConfig.ts — without `(?:\s+\d+)?`
            # both sheets collapse into the single `modul5-wasser` slot (tests/test_config_doctrine).
            "match": r"modul\s*5(?:\s*[-–—]\s*([0-9A-Za-zÄÖÜäöü]+(?:\s+\d+)?))?",
        },
        {"id": "modul4", "code": "M4", "title": "Spezialplan", "order": 7, "match": r"modul\s*4"},
    ],
    "fleet": {
        # Data-driven Auswahl-Vorschläge: attach a suggestion list to a symbol field.
        # `field` is "title" (the title combobox) or a detail-row key ("Typ", "Einheit", …).
        # Free typing always stays possible; edit in Verwaltung › Fahrzeuge & Geräte.
        # (Legacy vehicleTypes/luefterTypes/kleinloeschTypes/partner still work as a fallback.)
        "attributeLists": [
            {"symbol": "VKF Fahrzeug", "field": "title", "options": ["TLF", "ADL", "HLF", "ELW"]},
            # «Akku» is its own answer, not a flavour of «Elektro»: a battery fan needs no cable
            # and no generator, which is the whole reason the Front asks which one is up there.
            {"symbol": "VKF Luefter mobil", "field": "Typ", "options": ["Überdruck", "Elektro", "Akku"]},
            {"symbol": "FW Kleinloeschgeraet", "field": "Typ", "options": ["Wasser", "Schaum", "CO₂"]},
            {"symbol": "VKF Bereich Feuerwehr", "field": "Einheit", "options": ["Stützpunkt", "Nachbarwehr"]},
            {"symbol": "VKF Bereich Sanitaet", "field": "Einheit", "options": ["Rettungsdienst", "Rega"]},
            {"symbol": "VKF Bereich Polizei", "field": "Einheit", "options": ["Kantonspolizei"]},
            # What an Offizier on the Lage is DOING — the sector they were given, not their rank.
            # Shipped as a list because «Of-Front» and the four standing jobs are the ones every
            # Wehr runs; a station that names its sectors differently edits them in Verwaltung.
            {
                "symbol": "FW Offizier",
                "field": "Funktion",
                "options": ["Of-Front", "Lüften", "Atemschutz", "Retten", "Logistik"],
            },
        ],
        # «Herkunft»: ONE list for every vehicle symbol — where a vehicle that is not the own
        # Feuerwehr comes from. Empty = no suggestions; free typing always stays possible.
        "origins": ["Stützpunkt", "Nachbarwehr", "Zivilschutz"],
    },
    "doctrine": {
        "defaultFunkkanal": 1,
        "defaultFunkkanalEinfach": 4,
        "contactIntervalMin": 5,
        "contactGraceSec": 60,
        "alarmBar": 100,
        "alarmBarRueckzug": 50,
        # below this Eingangsdruck the Trupp form asks once («… ist für einen Eintritt tief»)
        "entryPressureMin": 270,
        # Modul-Pläne warn «nicht die Einsatzadresse» only when the nearest object is farther (m)
        "nearbyObjectWarnM": 25,
        # the hose Ø a Leitung without one reads as, and the one a Messen Wassertransport starts on
        "defaultLineHose": "40",
        "defaultRelayHose": "75",
    },
    "roster": {
        "source": "manual",
        # "last-first" = «Müller Hans» (the default, and what Divera delivers); "first-last"
        # for a station whose lists read the other way round.
        "nameOrder": "last-first",
        # Ordered Dienstgrade, most senior first (position = seniority). A station overrides this
        # to match its own ranks. The list itself lives in app/ranks.py because it is also the
        # RUNTIME fallback (personnel · load_roster_ranks_info) and the twin of src/lib/rank.ts.
        "ranks": [dict(r) for r in SWISS_DEFAULT_RANKS],
    },
    "mittel": {
        # Station catalogue of materials/equipment crews use up OR deploy. `unit` is the default
        # unit (editable per incident); `category` groups the picker + Bestand view; optional
        # `stock` is the nominal load-out per source (drives the used/available + Bestand readout).
        # Anything not listed can be typed in the app as «Anderes Mittel».
        "catalogue": [
            {"id": "schaummittel", "label": "Schaummittel", "unit": "l", "category": "Ölwehr"},
            {"id": "bindemittel", "label": "Ölbindemittel", "unit": "Sack", "category": "Ölwehr"},
            {
                "id": "luefter",
                "label": "Lüfter",
                "unit": "Stk.",
                "category": "Geräte",
                "stock": [{"source": "tlf", "qty": 2}, {"source": "lf", "qty": 1}],
            },
        ],
        # Where a material was drawn from (vehicle / depot / …); optional on every entry.
        "sources": [
            {"id": "tlf", "label": "TLF"},
            {"id": "lf", "label": "LF"},
            {"id": "depot", "label": "Magazin"},
        ],
        # Common unit suggestions for custom entries; free text always stays possible.
        # ⚠️ «Stk.» WITH the dot — it abbreviates «Stück», and a sheet printing «2 Stk.» on
        # one line and «1 Stk» on the next reads as two different units. The code default
        # has carried the dot since 6b2f5cc; these are the shipped DATA, and a station
        # whose catalogue was seeded before that still has the dotless form stored.
        "units": ["Stk.", "l", "m", "Sack", "Flasche", "kg"],
    },
    "alarms": {
        # Auto-open is no longer configurable: every alarm becomes an Einsatz on arrival, on
        # every path. `autoOpen` / `autoOpenPriorities` / `autoOpenKeywords` are still accepted
        # in existing config files and ignored; incidents nobody attended are kept out of the
        # statistics by `editor_opened_at`, not by a keyword filter (docs/STATS-EXPORT.md).
        # Untouched auto-opened incidents (never any workspace sync) archive after N days;
        # 0 disables the sweep. Archived incidents stay visible in the Verlauf/history.
        "autoArchiveDays": 7,
        # …and incidents that WERE worked on but never closed — nobody archives an Einsatz
        # unless they know they have to, so without this they stay open forever. Own, longer
        # clock, measured from the last edit; never stamps report_done_at. 0 disables it.
        "staleIncidentDays": 30,
        # Erfassungs-Poster reach: how long after opening an incident the station capture
        # link (/e/<token>) can still record attendance/material/notes for it.
        "captureWindowHours": 12,
        # Outbound: every URL gets a POST on incident creation (see docs/ALARM-INTEGRATIONS.md).
        # Fail-open — retried + logged, never blocking intake. [] = off.
        "webhooks": [],
    },
}


def _push(
    raw: dict[str, Any], doc_json: dict[str, Any], base: str, admin_secret: str, dry_run: bool, force: bool
) -> int:
    """Publish a config file to a RUNNING deployment over its HTTP API.

    The other three station CLIs (`admin_geodata`, `admin_objects`, `admin_checklists`) already
    have this; `admin_config` did not, and it was the one that needed it most. Everything else
    here talks to ``DATABASE_URL`` directly, which is fine on Railway and in dev but false on the
    documented docker-compose deployment: there is no Python toolchain on that host and the
    database is deliberately not reachable from outside the compose network. The setup guide's
    "make it your station" step was therefore not runnable as written, and the obvious way to
    make it run — publishing the Postgres port — is a security regression caused by a doc gap.

    Same guarantees as `load`, enforced against the REMOTE document:

    * the runtime-written sections are carried over (`referenceLayers`, `identity.assets`), so a
      file that never mentions them cannot delete a station's hydrants or its brandmark;
    * a push that would EMPTY a populated section is refused without ``--force``;
    * ``If-Match`` carries the version just read, so a deployment that changed underneath this
      push is a 409 rather than a silent overwrite.

    ⚠️ Those three are now the SERVER's rules too (app/api/config · put_config), which is what
    makes them true for an agent holding curl as well. This function keeps checking them anyway:
    the refusal a person reads at a terminal names every section that would go and says which
    flag overrides it, and that is worth more than an HTTP status. ``--force`` is therefore both
    a local override and ``?force=true`` on the wire — without the query parameter the server
    would refuse the very push this command was told to make.
    """
    base = base.rstrip("/")
    with admin_client(base, admin_secret, timeout=120.0) as c:
        got = c.get("/api/config")
        if got.status_code != 200:
            fail(f"ERROR: GET /api/config failed ({got.status_code}): {got.text[:200]}")
        remote = got.json()
        version = remote.get("version")
        # ⚠️ Strip the RESPONSE-ONLY fields before comparing. `integrations` is env-derived,
        # `alarmVocabulary`/`categoryLabels` are derived and `version` is the document's own hash —
        # none of them exist in a config FILE, so leaving them in made `emptied_sections` report
        # "this push would empty alarmVocabulary and version" on a push of the deployment's own
        # config. A refusal that fires on a no-op is a refusal nobody will read twice.
        for response_only in RESPONSE_ONLY_FIELDS:
            remote.pop(response_only, None)

        carried = carry_runtime_sections(remote, doc_json)
        dropped = emptied_declared_sections(remote, doc_json)
        if dropped and not force:
            print(f"REFUSED: this would EMPTY {len(dropped)} section(s) on {base}:", file=sys.stderr)
            for d in dropped:
                print(f"  - {d}", file=sys.stderr)
            print("", file=sys.stderr)
            print("That is what publishing an OLD config file looks like. Check the file is the", file=sys.stderr)
            print("one you meant (`admin_config diff` against a local copy), or repeat with --force.", file=sys.stderr)
            return 2

        if dry_run:
            print(f"OK (dry-run): authenticated to {base}; would change {_summary(doc_json, remote)}. Nothing written.")
            if carried:
                print(f"    would keep from the deployment (runtime-written): {', '.join(carried)}")
            _report_notes(raw, doc_json)
            return 0

        headers = {"If-Match": version} if version else {}
        params = {"force": "true"} if force else {}
        put = c.put("/api/config", json=doc_json, headers=headers, params=params)
        if put.status_code == 409:
            fail(
                "ERROR: the deployment's config changed while this push was being prepared. "
                "Nothing was written — re-run to pick up the newer document."
            )
        if put.status_code != 200:
            fail(f"ERROR: PUT /api/config failed ({put.status_code}): {put.text[:300]}")

    print(f"OK: pushed to {base}. Top-level keys set: {_summary(doc_json)}")
    if carried:
        print(f"    kept from the deployment (runtime-written, not in the file): {', '.join(carried)}")
    print(f"    {_vocabulary_line(doc_json)}")
    _report_notes(raw, doc_json)
    return 0


def _format_validation_error(path: Path, err: ValidationError) -> str:
    """Turn a pydantic ValidationError into precise ``field.path: message`` lines, headed by the
    file that failed. The lines themselves are the same ones ``POST /api/config/validate``
    answers with (config_guard · format_validation_errors)."""
    lines = [f"ERROR: {path} failed DeploymentConfigIn validation ({err.error_count()} issue(s)):"]
    lines.extend(f"  {line}" for line in format_validation_errors(err))
    return "\n".join(lines)


def _read_and_validate(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Read + parse + validate a config file. Exits on error.

    Returns ``(raw, normalized)`` — the document as WRITTEN and the document as the schema
    understood it. The raw half is what makes «this key was ignored» reportable at all: by the
    time pydantic is done, a misspelled key is simply gone (config_guard · ignored_keys).
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as e:
        fail(f"ERROR: cannot read {path}: {e}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        fail(f"ERROR: {path} is not valid JSON: {e}")
    if not isinstance(data, dict):
        fail(f"ERROR: {path} must contain a JSON object at the top level, got {type(data).__name__}.")
    try:
        doc = DeploymentConfigIn(**data)
    except ValidationError as e:
        fail(_format_validation_error(path, e))
    return data, doc.model_dump(mode="json")


def _diff(old: dict[str, Any] | None, new: dict[str, Any], prefix: str = "") -> list[str]:
    """Recursive, readable diff between two JSON documents → ``path: old -> new`` lines."""
    out: list[str] = []
    old = old or {}
    for key in sorted(set(old) | set(new)):
        p = f"{prefix}{key}"
        in_old, in_new = key in old, key in new
        ov, nv = old.get(key), new.get(key)
        if in_old and not in_new:
            out.append(f"  - {p}: {json.dumps(ov, ensure_ascii=False)}")
        elif in_new and not in_old:
            out.append(f"  + {p}: {json.dumps(nv, ensure_ascii=False)}")
        elif isinstance(ov, dict) and isinstance(nv, dict):
            out.extend(_diff(ov, nv, prefix=f"{p}."))
        elif ov != nv:
            out.append(f"  ~ {p}: {json.dumps(ov, ensure_ascii=False)} -> {json.dumps(nv, ensure_ascii=False)}")
    return out


def _summary(doc_json: dict[str, Any], baseline: dict[str, Any] | None = None) -> str:
    """Concise one-liner: which top-level sections differ from the comparison document.

    Validation compares against schema defaults. A load/push dry-run compares against what is
    stored, because a file normalized from `{}` still carries defaults and may reset a station's
    non-default values. The summary must name that change rather than reassuring with «empty».
    """
    comparison = baseline if baseline is not None else DeploymentConfigIn().model_dump(mode="json")
    set_keys = [key for key, val in doc_json.items() if val != comparison.get(key)]
    return ", ".join(set_keys) if set_keys else "(none — empty config)"


def _report_notes(raw: dict[str, Any], doc_json: dict[str, Any]) -> None:
    """Print the advisory lines every write path owes the operator: keys the schema dropped, and
    reference layers that cannot resolve. Indented under the command's own OK/REFUSED line."""
    ignored = ignored_keys(raw)
    if ignored:
        print(f"    ⚠️ {len(ignored)} key(s) IGNORED — the schema keeps only what it knows:")
        for line in ignored:
            print(f"       ignored: {line}")
    for warning in layer_warnings(doc_json):
        print(f"    ⚠️ {warning}")


def _vocabulary_line(doc_json: dict[str, Any]) -> str:
    """One line naming the alarm vocabulary this file puts in charge.

    Printed by validate/load/diff because the block is long, replaces the shipped words
    WHOLESALE, and decides how every alarm is classified — «19 keywords became 4» is the kind
    of thing that must be visible in the terminal, not only in the JSON.
    """
    from .alarm_keywords import SHIPPED

    block = doc_json.get("alarmKeywords")
    if not block:
        return (
            f"alarm vocabulary: the shipped default "
            f"({len(SHIPPED.keyword_to_category)} title keywords, "
            f"{len(SHIPPED.high_priority_keywords)} high-priority) — app/data/alarm_keywords.json"
        )
    pairs = (block.get("keyword_to_category") or {}).get("pairs") or []
    high = sum(len(g.get("keywords") or []) for g in (block.get("high_priority_keywords") or {}).get("groups") or [])
    return (
        f"alarm vocabulary: THIS DEPLOYMENT'S OWN ({len(pairs)} title keywords, {high} high-priority, "
        f"fallback «{block.get('fallback_category')}») — it REPLACES the shipped file wholesale"
    )


async def _show() -> dict[str, Any] | None:
    async with async_session_maker() as db:
        row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
        return row.config_json if (row and row.config_json) else None


async def _load(doc_json: dict[str, Any]) -> None:
    """Write a document that is ALREADY final — the runtime sections have been carried into it by
    the caller (see `_prepare`), so what lands is exactly what the caller was shown and checked."""
    async with async_session_maker() as db:
        row = await config_row(db, lock=True)
        # keep what is being replaced — this is the path with no user behind it and no undo of
        # its own, and it is the one that publishes a whole file (app/config_history)
        await keep_previous(db, "cli")
        row.config_json = doc_json
        await db.commit()


async def _prepare(doc_json: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """The stored document, and the runtime sections carried into `doc_json` (mutated in place).

    ⚠️ Split out of `_load` so the destructive-load check can run against what will ACTUALLY be
    written. Checking the raw file instead would have reported `referenceLayers` and
    `identity.assets` as emptied on every run — those are never in the file, they are carried —
    and the refusal would have fired on the nightly demo reset, i.e. on the one caller that is
    always correct.
    """
    async with async_session_maker() as db:
        row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
        stored = row.config_json if (row and row.config_json) else None
    carried = carry_runtime_sections(stored, doc_json)
    return stored, carried


async def _history() -> list[tuple[int, str, str | None, dict[str, Any] | None]]:
    """(id, replaced_at, source, document) for every kept config, newest first."""
    async with async_session_maker() as db:
        rows = (
            await db.execute(
                select(DeploymentConfigHistory).order_by(DeploymentConfigHistory.replaced_at.desc()).limit(50)
            )
        ).scalars()
        return [(r.id, r.replaced_at.isoformat(), r.source, r.config_json) for r in rows]


async def _restore(entry_id: int) -> dict[str, Any] | None:
    """Put a kept document back. The document being replaced is itself kept first, so a restore
    is as undoable as anything else — including a restore of the wrong entry."""
    async with async_session_maker() as db:
        entry = (
            await db.execute(select(DeploymentConfigHistory).where(DeploymentConfigHistory.id == entry_id))
        ).scalar_one_or_none()
        if entry is None or not entry.config_json:
            return None
        row = await config_row(db, lock=True)
        await keep_previous(db, "cli")
        row.config_json = entry.config_json
        await db.commit()
        return entry.config_json


def _normalize_argv(argv: list[str]) -> list[str]:
    """Back-compat shim: map the legacy ``<file>`` and ``--show`` forms onto subcommands."""
    # ⚠️ Every subcommand must be listed here. It is not a nicety: anything missing falls
    # through to the legacy branch and is rewritten as `load <name>` — so a new command silently
    # becomes a load of a file that does not exist, or worse, of one that does.
    cmds = {"schema", "example", "validate", "diff", "load", "push", "show", "history", "restore"}
    if not argv or argv == ["--show"]:
        return ["show"]
    if argv[0] in cmds or argv[0] in ("-h", "--help"):
        return argv
    # Legacy: a bare path (optionally with --dry-run) means ``load``.
    return ["load", *argv]


async def _amain(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.admin_config",
        description="Manage the kp-front deployment-config singleton row (config-as-code).",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("schema", help="print the config JSON Schema (no DB)")
    sub.add_parser("example", help="print a populated example config (no DB)")
    p_val = sub.add_parser("validate", help="validate a file, no write (no DB)")
    p_val.add_argument("file")
    p_diff = sub.add_parser("diff", help="show changes a file would make vs stored config")
    p_diff.add_argument("file")
    p_load = sub.add_parser("load", help="validate + upsert a file into the row")
    p_load.add_argument("file")
    p_load.add_argument("--dry-run", action="store_true", help="validate only, do not write")
    p_load.add_argument(
        "--force",
        action="store_true",
        help="load even if it would EMPTY sections that currently have content (see the refusal)",
    )
    p_push = sub.add_parser("push", help="publish a file to a RUNNING deployment via its API (no DB access needed)")
    p_push.add_argument("file")
    add_push_args(p_push, dry_run_help="authenticate + report only, do not write")
    p_push.add_argument(
        "--force",
        action="store_true",
        help="push even if it would EMPTY sections that currently have content (see the refusal)",
    )
    sub.add_parser("show", help="print the currently-stored config")
    sub.add_parser("history", help="list the kept previous configs (newest first)")
    p_restore = sub.add_parser("restore", help="put a kept config back (see `history` for the id)")
    p_restore.add_argument("id", type=int)

    args = parser.parse_args(_normalize_argv(argv))

    if args.cmd == "schema":
        print(json.dumps(DeploymentConfigIn.model_json_schema(), indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "example":
        print(json.dumps(EXAMPLE_CONFIG, indent=2, ensure_ascii=False))
        return 0
    if args.cmd == "validate":
        raw, doc_json = _read_and_validate(Path(args.file))
        print(f"OK: {args.file} is valid. Top-level keys set: {_summary(doc_json)}")
        print(f"    {_vocabulary_line(doc_json)}")
        _report_notes(raw, doc_json)
        return 0
    if args.cmd == "diff":
        _, doc_json = _read_and_validate(Path(args.file))
        stored = await _show()
        carried = carry_runtime_sections(stored, doc_json)
        changes = _diff(stored, doc_json)
        if not changes:
            print("No changes — the file matches the stored config.")
        else:
            print(f"{len(changes)} change(s) vs stored config:")
            print("\n".join(changes))
        if carried:
            print(f"    kept from the stored config (runtime-written): {', '.join(carried)}")
        print(_vocabulary_line(doc_json))
        return 0
    if args.cmd == "push":
        require_push_target(args)
        raw, doc_json = _read_and_validate(Path(args.file))
        return _push(raw, doc_json, args.base, args.admin_secret, args.dry_run, args.force)
    if args.cmd == "load":
        raw, doc_json = _read_and_validate(Path(args.file))
        # A normalized `{}` carries schema defaults and can reset stored non-defaults. Compare
        # even in dry-run so it never reports «empty config» for a real change.
        stored, carried = await _prepare(doc_json)
        if args.dry_run:
            print(f"OK (dry-run): {args.file} is valid; not written. Would change: {_summary(doc_json, stored)}")
            if carried:
                print(f"    would keep from the stored config (runtime-written): {', '.join(carried)}")
            print(f"    {_vocabulary_line(doc_json)}")
            _report_notes(raw, doc_json)
            return 0
        # ⚠️ REFUSE a load that would empty something that currently has content, unless it is
        # asked for explicitly. This is the shape of every one of these incidents: publishing an
        # OLD file over a newer config, which reports success while a station quietly loses its
        # Dienstgrade, its Atemschutz-Doktrin and its Partnerorganisationen. Every step said OK
        # each time it happened. A file that legitimately clears a section (a station dropping
        # its Partnerliste) passes --force and means it.
        # carry the runtime sections FIRST, then check what the final document would empty
        dropped = emptied_declared_sections(stored, doc_json)
        if dropped and not args.force:
            print(
                f"REFUSED: {args.file} would EMPTY {len(dropped)} section(s) that currently have content:",
                file=sys.stderr,
            )
            for d in dropped:
                print(f"  - {d}", file=sys.stderr)
            print("", file=sys.stderr)
            print("This is what publishing an OLD config file looks like. Check the file is the", file=sys.stderr)
            print("one you meant (`git log examples/... ` / `admin_config diff <file>`).", file=sys.stderr)
            print("If the emptying is intended, repeat with --force.", file=sys.stderr)
            return 2
        await _load(doc_json)
        print(f"OK: loaded {args.file} into deployment_config id=1.")
        if dropped:
            # forced through — say what went, because nothing else will
            print(f"    ⚠️ EMPTIED (--force): {', '.join(dropped)}")
        print(f"    top-level keys set: {_summary(doc_json)}")
        if carried:
            # said out loud: the file did NOT contain these, and they are still there
            print(f"    kept from the stored config (runtime-written, not in the file): {', '.join(carried)}")
        print(f"    {_vocabulary_line(doc_json)}")
        _report_notes(raw, doc_json)
        return 0
    if args.cmd == "history":
        entries = await _history()
        if not entries:
            print("No previous configs kept yet (nothing has overwritten this one).")
            return 0
        print(f"{len(entries)} kept config(s), newest first — restore with `admin_config restore <id>`:")
        for eid, at, src, doc in entries:
            print(f"  [{eid}] {at}  via {src or '?'}  ({_summary(doc or {})})")
        return 0
    if args.cmd == "restore":
        doc = await _restore(args.id)
        if doc is None:
            print(f"ERROR: no kept config with id {args.id} (see `admin_config history`).", file=sys.stderr)
            return 1
        print(f"OK: restored kept config [{args.id}] into deployment_config id=1.")
        print(f"    top-level keys set: {_summary(doc)}")
        print("    the document it replaced was itself kept — `history` again to step back.")
        return 0
    # show
    stored = await _show()
    print(
        json.dumps(stored, indent=2, ensure_ascii=False)
        if stored
        else "No deployment config stored (row absent or empty)."
    )
    return 0


def main() -> None:
    sys.exit(asyncio.run(_amain(sys.argv[1:])))


if __name__ == "__main__":
    main()
