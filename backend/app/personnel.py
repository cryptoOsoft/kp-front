"""Divera247 Mannschaft (crew) sync service.

Fetches member names from the Divera *pull* API and reconciles them with the
``personnel`` table. The Divera member id is the stable key; display names are
snapshots. Stale members (a divera_id no longer returned by Divera) are deactivated
on request, never hard-deleted — old incidents/reports keep referencing them.

The diff (:func:`diff_members`) is pure so it can be unit-tested without a database.
Rank adoption locks and reloads the deployment config before deriving its replacement.
"""

import csv
import difflib
import io
import logging
import re
import unicodedata
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .credentials import get as credential
from .deployment_config import config_row
from .divera import check_response
from .models import DeploymentConfig, Personnel, PersonnelExternalIdentity
from .ranks import SWISS_DEFAULT_RANKS

logger = logging.getLogger(__name__)

# The member pull lives on a different host than the alarm API (settings.divera_api_url).
DIVERA_PULL_BASE_URL = "https://www.divera247.com/api/v2"

# Rank (Dienstgrad) source, verified 2026-07-01 against the real /pull/all: Divera has NO rank
# field. It DOES expose per-member Qualifikationen — but ONLY for a user whose read scope includes
# them (the alarm accesskey returns empty `qualifications`; the winfap/personnel key returns the
# real list). Each consumer's `qualifications` is a list of qualification IDs referencing
# `cluster.qualification` (id → {name, shortname}). We map those names against the station rank
# list and take the most senior match as the member's rank (see :func:`derive_rank_from_quals`).
# So rank is derived from Divera when the personnel key can see qualifications; otherwise it stays
# whatever it was (CSV import remains a fallback).


#: The station-wide name order (config ``roster.nameOrder``) — see :class:`schemas.RosterConfig`.
NameOrder = Literal["last-first", "first-last"]

#: Fallback for every caller that cannot reach the config (pure helpers, seeds, CSV import).
DEFAULT_NAME_ORDER: NameOrder = "last-first"

#: How much the unattended sync may do (config ``roster.autoSync``) — see
#: :class:`schemas.RosterConfig` for what each level means.
AutoSyncLevel = Literal["off", "safe", "full"]

#: The level a station that has never chosen one runs at: apply what arrives, deactivate nobody.
DEFAULT_AUTO_SYNC: AutoSyncLevel = "safe"


class _SplitNamePerson(Protocol):
    """A roster row as :func:`person_display_name` reads it — the stored string plus the split
    it may or may not have."""

    display_name: str
    first_name: str | None
    last_name: str | None


class _ExistingPerson(Protocol):
    id: object
    external_id: str | None
    display_name: str
    rank: str | None
    is_active: bool


@dataclass
class ProviderPerson:
    """Canonical person plus the provider identity used by one adapter sync.

    ``external_id`` stays the opaque string the provider issued. Divera's happen to be
    numeric; blaulichtSMS hands out hex (``2342343242342abcde32423423``). This field was
    typed ``int`` and coerced on read, which silently dropped the identity of every person
    whose provider ID wasn't a number — so a second provider could never have worked.
    """

    id: object
    external_id: str | None
    display_name: str
    rank: str | None
    is_active: bool


async def provider_people(db: AsyncSession, provider: str) -> list[ProviderPerson]:
    """Load personnel through generic external identities.

    The deprecated column is a fallback only for databases in the migration window.
    """
    people = list((await db.execute(select(Personnel))).scalars())
    identities = list(
        (
            await db.execute(select(PersonnelExternalIdentity).where(PersonnelExternalIdentity.provider == provider))
        ).scalars()
    )
    external_by_person = {identity.personnel_id: identity.external_id for identity in identities}
    out: list[ProviderPerson] = []
    for person in people:
        external_id = external_by_person.get(person.id)
        if external_id is None and provider == "divera" and person.divera_id is not None:
            external_id = str(person.divera_id)
        out.append(ProviderPerson(person.id, external_id, person.display_name, person.rank, person.is_active))
    return out


async def attach_external_identity(
    db: AsyncSession, *, person: Personnel, provider: str, external_id: str, metadata: dict | None = None
) -> PersonnelExternalIdentity:
    identity = (
        await db.execute(
            select(PersonnelExternalIdentity).where(
                PersonnelExternalIdentity.provider == provider,
                PersonnelExternalIdentity.external_id == external_id,
            )
        )
    ).scalar_one_or_none()
    if identity is None:
        identity = PersonnelExternalIdentity(
            personnel_id=person.id, provider=provider, external_id=external_id, metadata_json=metadata
        )
        db.add(identity)
    else:
        identity.personnel_id = person.id
        identity.metadata_json = metadata
        identity.synced_at = datetime.now(UTC)
    return identity


def normalize_name(name: str) -> str:
    """Lowercase, strip accents, collapse whitespace — for name-based comparison."""
    name = " ".join(name.split()).strip().lower()
    name = unicodedata.normalize("NFD", name)
    return "".join(c for c in name if unicodedata.category(c) != "Mn")


def split_name(stdformat_name: str, firstname: str, lastname: str) -> tuple[str, str]:
    """The ``(lastname, firstname)`` a Divera member record yields — either may be blank.

    ``stdformat_name`` arrives as ``"Lastname, Firstname"`` and wins where it is unambiguous;
    the explicit fields fill the gaps. Kept separate from :func:`format_name` because the sync
    persists the two halves as well as the joined string: without them a stored name cannot be
    reordered later, so a station flipping ``roster.nameOrder`` would see nothing change.
    """
    last, first = "", ""
    if stdformat_name:
        parts = stdformat_name.split(",", 1)
        if len(parts) == 2:
            last, first = parts[0].strip(), parts[1].strip()
        else:
            last = stdformat_name.strip()
    return last or lastname.strip(), first or firstname.strip()


def format_name(
    stdformat_name: str, firstname: str, lastname: str, order: NameOrder = DEFAULT_NAME_ORDER
) -> str | None:
    """Build the full display name in the station's ``roster.nameOrder`` — ``"Müller Hans"``
    under the default ``"last-first"`` (so the list sorts/searches by surname), ``"Hans
    Müller"`` under ``"first-last"``. The map's Trupp chip abbreviates this client-side;
    everywhere else uses the full name.

    ``order`` defaults to the shipped default, so a caller with no config in reach (seeds, a
    pure test) still produces the name a fresh deployment serves.
    """
    last, first = split_name(stdformat_name, firstname, lastname)
    if not last and not first:
        return None
    if last and first:
        return f"{first} {last}" if order == "first-last" else f"{last} {first}"
    return last or first


def person_display_name(person: _SplitNamePerson, order: NameOrder = DEFAULT_NAME_ORDER) -> str:
    """The name to SERVE for an existing roster row, in ``order``.

    Rebuilt from the split ``first_name``/``last_name`` when both are there — that is the only
    case where the two tokens are known for certain, so it is the only case where reordering is
    safe. Everyone else (hand-entered crew, CSV rows, anything imported as one string) keeps
    their stored ``display_name`` verbatim: guessing which token of «Von Arx Beat» is the
    surname would rename people, and a roster that renames people is worse than one that reads
    in the wrong order. Pure — the caller supplies the order (see :func:`load_roster_name_order`).
    """
    first = (person.first_name or "").strip()
    last = (person.last_name or "").strip()
    if first and last:
        return f"{first} {last}" if order == "first-last" else f"{last} {first}"
    return person.display_name


def name_sort_key(name: str) -> str:
    """Sort key for a roster list: accent- and case-insensitive, so Ä sorts with A and the
    order does not depend on the database's collation. Deterministic, no locale needed."""
    return normalize_name(name)


def match_rank(text: str, ranks: list[dict]) -> str | None:
    """Map a free-text CSV rank cell onto a config rank ``key``.

    Matches (accent/case/space-insensitively) against each rank's ``key``, ``label`` or
    ``abbr``. Returns the key, or ``None`` when blank/unmatched. Pure — the caller supplies
    the active rank list (see :func:`load_roster_ranks`)."""
    needle = normalize_name(text or "")
    if not needle:
        return None
    for r in ranks:
        candidates = (r.get("key"), r.get("label"), r.get("abbr"))
        if any(normalize_name(c) == needle for c in candidates if c):
            return r.get("key")
    return None


def derive_rank_from_quals(qual_names: list[str], ranks: list[dict]) -> str | None:
    """Pick a member's Dienstgrad from their Divera qualification names.

    Each qualification name is matched against the station rank list (:func:`match_rank`); the
    MOST SENIOR match wins (rank list is ordered senior-first, so lowest index). Members whose
    qualifications include no rank fall back to the base rank — the most junior entry in the
    list (e.g. Feuerwehrmann) — so the whole roster is ranked; returns ``None`` only when the
    list is empty. Pure."""
    if not ranks:
        return None
    best_idx = None
    for name in qual_names:
        key = match_rank(name, ranks)
        if key is None:
            continue
        idx = next((i for i, r in enumerate(ranks) if r.get("key") == key), None)
        if idx is not None and (best_idx is None or idx < best_idx):
            best_idx = idx
    if best_idx is not None:
        return ranks[best_idx]["key"]
    return ranks[-1]["key"]  # base rank — everyone is at least this


async def load_roster_ranks_info(db: AsyncSession) -> tuple[list[dict], bool]:
    """``(active rank list, station has one of its own)``.

    ⚠️ The second half is the part that is easy to get wrong. A station whose ``roster.ranks``
    is EMPTY is not a station without ranks — every reader falls back to the shipped Swiss list
    (here and in src/lib/rank.ts), so «Wm» matches on a brand-new install and only a genuinely
    foreign value like «Sdt» is unknown. Anything that offers to WRITE the rank list has to know
    which of the two lists it is looking at: appending to the fallback without materialising it
    first would replace twelve working ranks with one (see :func:`adopt_ranks`)."""
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    ranks = ((row.config_json or {}).get("roster", {}) or {}).get("ranks") if row else None
    if ranks:
        return list(ranks), True
    return [dict(r) for r in SWISS_DEFAULT_RANKS], False


async def load_roster_ranks(db: AsyncSession) -> list[dict]:
    """The active station rank list (stored config → in-code default), for import mapping."""
    ranks, _own = await load_roster_ranks_info(db)
    return ranks


async def load_roster_name_order(db: AsyncSession) -> NameOrder:
    """The station's ``roster.nameOrder`` (stored config → shipped default).

    Read on every request that serves names — the order is applied when a name goes out, never
    when it is stored, so flipping the setting takes effect without a migration or a re-sync."""
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    value = ((row.config_json or {}).get("roster", {}) or {}).get("nameOrder") if row else None
    return "first-last" if value == "first-last" else DEFAULT_NAME_ORDER


async def load_roster_auto_sync(db: AsyncSession) -> AutoSyncLevel:
    """The station's ``roster.autoSync`` (stored config → the shipped ``"safe"``).

    Read on every run of the nightly job rather than at boot, so switching the level in
    Verwaltung takes effect tonight and not at the next deploy — the same reason the scheduler
    re-reads its credentials on every tick."""
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    value = ((row.config_json or {}).get("roster", {}) or {}).get("autoSync") if row else None
    return value if value in ("off", "safe", "full") else DEFAULT_AUTO_SYNC


async def load_divera_response_kinds(db: AsyncSession) -> dict:
    """The station's ``roster.diveraResponses`` override (status id/name → kind), or ``{}``."""
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    value = ((row.config_json or {}).get("roster", {}) or {}).get("diveraResponses") if row else None
    return value if isinstance(value, dict) else {}


# ─── CSV roster import ─────────────────────────────────────────────────────────────────
#
# Parsing, grouping and rank adoption for the CSV import. Split out of the endpoint because the
# import happens in two passes over the SAME file: a preview that writes nothing, and an apply
# that writes only after every unknown rank has been decided. Both passes must read the file
# identically, so there is exactly one parser.


@dataclass
class RosterCsvRow:
    """One accepted data row of a roster CSV. ``line`` is the 1-based line in the file
    (header = 1), which is what an error message has to name to be actionable."""

    line: int
    name: str
    rank_text: str
    provider: str
    external_id: str


@dataclass
class ParsedRoster:
    rows: list[RosterCsvRow] = field(default_factory=list)
    #: rows that cannot be imported at all (no name, malformed identity) — never written
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class UnknownRankGroup:
    """One rank VALUE the station's list does not know — not one row, one value.

    ⚠️ Value, not row. Forty people with the same «Sdt» are one question, and the old import
    answered it forty times in a list of grey bullets under a green success badge. ``people``
    carries a few names so the operator can see WHO is affected without opening the file."""

    value: str
    count: int
    people: list[str]
    #: a known rank key this value probably means (close spelling), or None
    suggestion: str | None


def parse_roster_csv(text: str) -> ParsedRoster:
    """Read a roster CSV into rows + the row-level problems. Pure, writes nothing.

    Raises :class:`ValueError` when the file has no usable header — the one condition under
    which there is nothing to preview and nothing to import.
    """
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None or "name" not in {(f or "").strip().lower() for f in reader.fieldnames}:
        raise ValueError("CSV-Kopfzeile fehlt oder enthält keine Spalte 'name'")

    out = ParsedRoster()
    for line, raw in enumerate(reader, start=2):  # line 1 is the header
        cells = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        name = cells.get("name", "")
        if not name:
            out.skipped += 1
            out.errors.append(f"Zeile {line}: 'name' fehlt")
            continue
        legacy_divera = cells.get("divera_id") or ""
        if legacy_divera:
            try:
                int(legacy_divera)  # legacy contract was numeric; keep rejecting malformed rows
            except ValueError:
                out.skipped += 1
                out.errors.append(f"Zeile {line}: ungültige Zahl (divera_id)")
                continue
        provider = (cells.get("provider") or ("divera" if legacy_divera else "")).lower()
        external_id = cells.get("external_id") or legacy_divera or ""
        if provider and not external_id:
            out.skipped += 1
            out.errors.append(f"Zeile {line}: provider braucht external_id")
            continue
        out.rows.append(
            RosterCsvRow(
                line=line,
                name=name,
                rank_text=cells.get("rank", ""),
                provider=provider,
                external_id=external_id,
            )
        )
    return out


#: How alike two rank spellings have to be before one is offered as the other's meaning.
#: Tuned so «Oblt.» → oblt (0.89) is proposed and «Sdt» → kdt (0.67) is not: a wrong proposal
#: that gets confirmed at 3am is worse than no proposal at all.
_RANK_SUGGEST_CUTOFF = 0.82


def suggest_rank(value: str, ranks: Sequence[dict]) -> str | None:
    """The known rank key whose key/label/abbr is spelled closest to ``value`` — or None.

    A proposal only, never applied on its own: the operator sees it preselected in the mapping
    sheet and can overrule it."""
    needle = normalize_name(value)
    if not needle:
        return None
    best: tuple[float, str] | None = None
    for r in ranks:
        for candidate in (r.get("key"), r.get("label"), r.get("abbr")):
            if not candidate:
                continue
            score = difflib.SequenceMatcher(None, needle, normalize_name(candidate)).ratio()
            if score >= _RANK_SUGGEST_CUTOFF and (best is None or score > best[0]):
                best = (score, str(r.get("key")))
    return best[1] if best else None


#: How many affected names travel with a group — enough to recognise the people, few enough
#: that a 40-row file stays one screen.
_GROUP_SAMPLE_NAMES = 6


def group_unknown_ranks(rows: Sequence[RosterCsvRow], ranks: Sequence[dict]) -> list[UnknownRankGroup]:
    """Every rank value in the file that ``ranks`` does not cover, grouped BY VALUE.

    Spelling variants of one value («Sdt», «sdt», « SDT ») are one group, labelled with the
    first spelling seen. Groups keep file order: the file's own order is the only ordering the
    operator can check against, and for a station adopting the whole column it becomes the
    seniority order of the new rank list."""
    groups: dict[str, UnknownRankGroup] = {}
    for row in rows:
        if not row.rank_text or match_rank(row.rank_text, list(ranks)):
            continue
        key = normalize_name(row.rank_text)
        group = groups.get(key)
        if group is None:
            group = UnknownRankGroup(
                value=row.rank_text, count=0, people=[], suggestion=suggest_rank(row.rank_text, ranks)
            )
            groups[key] = group
        group.count += 1
        if len(group.people) < _GROUP_SAMPLE_NAMES:
            group.people.append(row.name)
    return list(groups.values())


def _rank_key(value: str, taken: set[str]) -> str:
    """A config key for an adopted rank: a slug of the value, kept unique.

    Uniqueness matters more than beauty — two entries sharing a key would make one of them
    unreachable, and a person would carry a Dienstgrad that resolves to the other one."""
    base = re.sub(r"[^a-z0-9]+", "-", normalize_name(value)).strip("-") or "grad"
    key = base
    n = 2
    while key in taken:
        key = f"{base}-{n}"
        n += 1
    return key


def append_ranks(ranks: Sequence[dict], values: Sequence[str]) -> list[dict]:
    """``ranks`` + one new entry per value, appended in the given order. Pure.

    New ranks land at the END, i.e. junior-most: position in the list IS seniority here, and
    nothing in a CSV says where an unknown rank belongs. Guessing would silently reorder a
    station's hierarchy; appending is wrong in a way that is visible and fixable."""
    out = [dict(r) for r in ranks]
    taken = {str(r.get("key")) for r in out}
    for value in values:
        key = _rank_key(value, taken)
        taken.add(key)
        # label AND abbr are the raw value: the file is all we know, and inventing a long form
        # («Sdt» → «Soldat») would put a word on a Rapport that the station never wrote.
        out.append({"key": key, "label": value, "abbr": value, "tier": "crew"})
    return out


async def adopt_ranks(db: AsyncSession, values: Sequence[str], actor_id: uuid.UUID | None) -> list[dict]:
    """Write ``values`` into the station's ``roster.ranks`` and return the new list.

    ⚠️ This is a deployment-config write, and this config document has no partial writes — every
    writer replaces the whole thing, which has cost this project its config four times. Two rules
    keep this one safe:

    * The document is read from the DATABASE and one key path is changed. No client-side draft is
      involved, so no other section can be carried in stale and emptied — the same shape as the
      branding upload (app/api/branding.py), and the reason this does not need the If-Match guard
      that the Verwaltung's full-document PUT does.
    * :func:`config_history.keep_previous` runs first, in this session, so the write is undoable
      through «Letzte Änderungen» like every other one.

    ⚠️ On a station with no list of its OWN, the shipped Swiss default is materialised first. It
    was already the effective list, so this changes nothing anybody can see — but writing only the
    adopted ranks would leave every person already carrying «wm» or «kpl» pointing at a key that
    no longer exists.

    Caller's transaction: nothing is committed here, so an import that aborts afterwards takes
    the rank write down with it.
    """
    from .config_history import keep_previous  # local imports avoid an import cycle
    from .schemas import load_stored_config

    row = await config_row(db, lock=True)
    ranks, has_own = await load_roster_ranks_info(db)
    updated = append_ranks(ranks, values)
    await keep_previous(db, "roster", actor_id)
    raw = dict((row.config_json if row else None) or {})
    raw["roster"] = {**(raw.get("roster") or {}), "ranks": updated}
    # Read as a STORED document (`schemas · load_stored_config`), not through the strict PUT-body
    # model: a field that has grown a rule since it was written – an accentColor from before hex
    # was enforced – must not make a CSV import 500 on a document it never touched. The result is
    # still normalized, so the stored document stays canonical and GET round-trips it unchanged.
    doc_json = load_stored_config(raw).model_dump(mode="json")
    row.config_json = doc_json
    row.updated_by = actor_id
    await db.flush()
    logger.info(
        "roster.ranks: adopted %s from a CSV import (station had %s list, now %d ranks)",
        list(values),
        "its own" if has_own else "no",
        len(updated),
    )
    return updated


# ─── who a CSV row is ──────────────────────────────────────────────────────────────────
#
# A roster CSV carries no stable id, so every row has to be decided against the roster that is
# already there: does this line mean somebody the station has, or somebody new? Answering "new"
# by default is what let a second pick of the SAME file insert a whole Wehr a second time.
#
# The key, in this order:
#   1. ``provider`` + ``external_id`` — the canonical identity (personnel_external_identities).
#      The only key a system of record can hand us, and the one the sync already uses.
#   2. the person's NAME, normalized (accent-, case- and whitespace-insensitive). For anyone
#      whose name is stored split, BOTH spelling orders are indexed, so flipping
#      ``roster.nameOrder`` between two imports does not produce a second Wehr either.
#
# ⚠️ A name is not an identity. Two genuinely different people spelled the same collapse into
# ONE roster row: the second import updates the first person instead of adding the second. That
# trade is deliberate — a station of ~100 with two identical spellings is rare, an operator
# re-picking the same file is not, and the duplicate direction is the one the Verwaltung cannot
# undo (rows are referenced by Einsätze, so they are deactivated, never deleted). A real clash
# is resolved by spelling one of them apart (a middle initial) or by giving the file
# ``provider``/``external_id`` columns.


def roster_name_key(name: str) -> str:
    """The key a roster name is matched under — see the section note above."""
    return normalize_name(name)


def _name_variants(person: _SplitNamePerson, order: NameOrder) -> list[str]:
    """Every spelling of ``person`` an import may legitimately arrive with: what is stored,
    what the app currently SERVES, and — only where the split is known for certain — both
    orders. Guessing the halves of a one-string name is what :func:`person_display_name`
    refuses to do, and this must not do it either."""
    names = [person.display_name, person_display_name(person, order)]
    first = (person.first_name or "").strip()
    last = (person.last_name or "").strip()
    if first and last:
        names += [f"{last} {first}", f"{first} {last}"]
    return [n for n in names if n]


@dataclass
class RosterIndex:
    """What the roster looks like to an import, resolved once per pass."""

    by_external: dict[tuple[str, str], uuid.UUID]
    by_name: dict[str, uuid.UUID]
    #: ``(person, provider)`` pairs that already carry an identity — a second one for the same
    #: provider would violate uq_personnel_external_person_provider
    providers: set[tuple[uuid.UUID, str]]


@dataclass
class RosterTarget:
    """What one CSV row will do."""

    row: RosterCsvRow
    #: the existing roster row this touches, or None when this person does not exist yet
    person_id: uuid.UUID | None
    #: index of the plan entry that OWNS this person — its own index when this row is the first
    #: to name them. Two rows naming one person in one file are one person, not two.
    owner: int


@dataclass
class RosterPlan:
    """The whole file's effect, decided before anything is written. The preview and the write
    run the SAME planner, so the numbers the operator confirms are the numbers that happen."""

    targets: list[RosterTarget]
    creates: int
    updates: int
    #: names the FILE itself lists more than once, first spelling seen
    duplicate_names: list[str] = field(default_factory=list)


def plan_roster_rows(rows: Sequence[RosterCsvRow], index: RosterIndex) -> RosterPlan:
    """Resolve every row onto an existing person or onto a new one. Pure — no session touched."""
    targets: list[RosterTarget] = []
    owners: dict[tuple[str, str], int] = {}
    duplicates: dict[str, str] = {}
    creates = updates = 0
    for i, row in enumerate(rows):
        person_id: uuid.UUID | None = None
        if row.provider and row.external_id:
            person_id = index.by_external.get((row.provider, row.external_id))
        name_key = roster_name_key(row.name)
        if person_id is None:
            person_id = index.by_name.get(name_key)
        marker = ("id", str(person_id)) if person_id is not None else ("name", name_key)
        owner = owners.get(marker)
        if owner is None:
            owner = i
            owners[marker] = i
            if person_id is None:
                creates += 1
            else:
                updates += 1
        else:
            duplicates.setdefault(name_key, row.name)
        targets.append(RosterTarget(row=row, person_id=person_id, owner=owner))
    return RosterPlan(targets=targets, creates=creates, updates=updates, duplicate_names=list(duplicates.values()))


async def load_roster_index(db: AsyncSession) -> RosterIndex:
    """Read the roster into the lookup tables :func:`plan_roster_rows` matches against.

    ⚠️ The OLDEST row wins a name collision inside the roster. A station that already carries
    two people spelled the same — the duplicates every import before this fix left behind — gets
    those rows updated; it never gets a third one on top.
    """
    identities = list((await db.execute(select(PersonnelExternalIdentity))).scalars())
    people = list((await db.execute(select(Personnel).order_by(Personnel.created_at, Personnel.id))).scalars())
    order = await load_roster_name_order(db)
    by_name: dict[str, uuid.UUID] = {}
    for person in people:
        for name in _name_variants(person, order):
            by_name.setdefault(roster_name_key(name), person.id)
    return RosterIndex(
        by_external={(i.provider, i.external_id): i.personnel_id for i in identities},
        by_name=by_name,
        providers={(i.personnel_id, i.provider) for i in identities},
    )


async def fetch_divera_members(order: NameOrder = DEFAULT_NAME_ORDER) -> list[dict]:
    """Fetch crew members from the Divera pull API.

    Uses ``divera_personnel_access_key`` when set (it can see Qualifikationen), else the alarm
    ``divera_access_key``. Returns dicts with ``divera_id``, ``name`` (joined in ``order``),
    ``first_name``, ``last_name`` and ``qualifications`` (the member's qualification NAMES,
    resolved via the cluster catalogue — empty list when the key can't see them). Rank is
    derived from these at sync time.
    """
    access_key = credential("divera_personnel_access_key") or credential("divera_access_key")
    if not access_key:
        raise ValueError("Divera access key not configured")

    url = f"{DIVERA_PULL_BASE_URL}/pull/all"
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params={"accesskey": access_key})
        # NOT `raise_for_status()` — its message carries the URL, and the URL carries the
        # access key. See divera.DiveraApiError; this is the pull half of the same door.
        check_response(response)
        data = response.json()

    if not data.get("success"):
        raise ValueError("Divera API returned success=false")
    # the same response names the Rückmelde-Status — keep them, it saves the alarm poll a call
    from .divera_responses import remember_catalogue

    remember_catalogue(data)

    cluster = data.get("data", {}).get("cluster", {})
    # qualification catalogue: id → name (ints keyed by string ids)
    qual_names: dict[int, str] = {}
    for qid_str, q in (cluster.get("qualification") or {}).items():
        try:
            qual_names[int(qid_str)] = (q or {}).get("name") or ""
        except (ValueError, TypeError):
            continue

    consumer = cluster.get("consumer", {})
    members: list[dict] = []
    for member_id_str, info in consumer.items():
        if not isinstance(info, dict):
            continue
        try:
            divera_id = int(member_id_str)
        except (ValueError, TypeError):
            continue
        # Both halves come from the same split as the joined name, so a member Divera only
        # names via `stdformat_name` still lands with first_name/last_name filled — the pair
        # the read-time reorder needs.
        last, first = split_name(
            (info.get("stdformat_name") or "").strip(),
            (info.get("firstname") or "").strip(),
            (info.get("lastname") or "").strip(),
        )
        name = format_name("", first, last, order)
        if not name:
            continue
        # `qualifications` is a list of ids (or {id,…} objects) → resolve to catalogue names
        quals: list[str] = []
        for q in info.get("qualifications") or []:
            qid = q.get("id") if isinstance(q, dict) else q
            try:
                nm = qual_names.get(int(qid)) if qid is not None else None
            except (ValueError, TypeError):
                nm = None
            if nm:
                quals.append(nm)
        members.append(
            {
                "divera_id": divera_id,
                "name": name,
                "first_name": first or None,
                "last_name": last or None,
                "qualifications": quals,
            }
        )

    logger.info("Fetched %d members from Divera", len(members))
    return members


def diff_members(members: list[dict], existing: Sequence[_ExistingPerson]) -> dict:
    """Reconcile freshly-fetched Divera members against existing personnel by external identity.

    Matching runs on ``ProviderPerson.external_id`` (an opaque string), so the same diff works
    for a provider whose IDs are not numeric. The emitted ``divera_id`` keys are the Divera
    sync's wire contract with ``execute_sync`` and the admin preview — renaming those is a
    separate, larger change.

    Returns serializable categories: ``new`` (insert), ``updated`` (name/rank changed or
    currently inactive → reactivate), ``unchanged``, and ``stale`` (an active row whose
    identity is gone from Divera). Manually-added crew (no identity) are never stale.

    Rank is compared ONLY for members carrying a ``"rank"`` key (set upstream when the feed
    could see qualifications). When the key is absent (restricted access → no qualifications),
    rank is left out of the diff entirely, so a sync never wipes a CSV/admin-set rank.
    """
    by_external: dict[str, _ExistingPerson] = {p.external_id: p for p in existing if p.external_id is not None}
    seen_external: set[str] = set()
    new, updated, unchanged = [], [], []

    for m in members:
        did = m["divera_id"]
        external_id = str(did)
        seen_external.add(external_id)
        rank_known = "rank" in m
        rank = m.get("rank")
        person = by_external.get(external_id)
        if person is None:
            new.append({"divera_id": did, "name": m["name"], **({"rank": rank} if rank_known else {})})
        elif (
            person.display_name != m["name"]
            or not person.is_active
            or (rank_known and getattr(person, "rank", None) != rank)
        ):
            updated.append(
                {
                    "id": str(person.id),
                    "divera_id": did,
                    "name": m["name"],
                    "was_inactive": not person.is_active,
                    **({"rank": rank} if rank_known else {}),
                }
            )
        else:
            unchanged.append({"id": str(person.id), "divera_id": did, "name": m["name"]})

    stale = [
        {"id": str(p.id), "name": p.display_name}
        for p in existing
        if p.external_id is not None and p.external_id not in seen_external and p.is_active
    ]
    return {"new": new, "updated": updated, "unchanged": unchanged, "stale": stale}


async def _resolve_ranks(members: list[dict], db: AsyncSession) -> None:
    """In place: derive each member's rank from their qualifications, IF the feed carried any.

    A key that can't see qualifications returns them empty for everyone — in that case we leave
    ``rank`` unset on the member dicts so the sync doesn't touch existing ranks."""
    if not any(m.get("qualifications") for m in members):
        return
    ranks = await load_roster_ranks(db)
    for m in members:
        m["rank"] = derive_rank_from_quals(m.get("qualifications") or [], ranks)


async def build_sync_preview(db: AsyncSession) -> dict:
    """Fetch from Divera and diff against the DB — read-only, no writes."""
    order = await load_roster_name_order(db)
    members = await fetch_divera_members(order)
    await _resolve_ranks(members, db)
    existing = await provider_people(db, "divera")
    return diff_members(members, existing)


async def execute_sync(db: AsyncSession, *, deactivate_stale: bool) -> dict:
    """Fetch, diff, and apply in one transaction. Returns applied counts.

    Rank is derived from Divera qualifications when the personnel key can see them (authoritative
    then); if it can't, existing ranks are preserved untouched.

    ⚠️ A fetch that returns NOBODY applies nothing and raises. Every member of the station is
    stale against an empty feed, so with ``deactivate_stale`` this one API hiccup would
    deactivate the whole Wehr — and since 2026-09-11 the sync also runs unattended at night,
    where nobody would see it happen. An empty consumer list is a broken feed, not an empty
    Feuerwehr; the honest answer is the error, not a silent zero.
    """
    order = await load_roster_name_order(db)
    members = await fetch_divera_members(order)
    if not members:
        raise ValueError("Divera returned no members")
    await _resolve_ranks(members, db)
    by_member = {m["divera_id"]: m for m in members}
    existing = await provider_people(db, "divera")
    diff = diff_members(members, existing)
    canonical = list((await db.execute(select(Personnel))).scalars())
    by_id = {str(p.id): p for p in canonical}

    for item in diff["new"]:
        m = by_member[item["divera_id"]]
        person = Personnel(
            display_name=m["name"],
            first_name=m["first_name"],
            last_name=m["last_name"],
            rank=m.get("rank"),
            is_active=True,
        )
        db.add(person)
        await db.flush()
        await attach_external_identity(
            db,
            person=person,
            provider="divera",
            external_id=str(m["divera_id"]),
            metadata={"first_name": m["first_name"], "last_name": m["last_name"]},
        )
    reactivated = 0
    for item in diff["updated"]:
        person = by_id[item["id"]]
        m = by_member[item["divera_id"]]
        person.display_name = m["name"]
        person.first_name = m["first_name"]
        person.last_name = m["last_name"]
        if "rank" in m:
            person.rank = m["rank"]
        if not person.is_active:
            person.is_active = True
            reactivated += 1
        await attach_external_identity(
            db,
            person=person,
            provider="divera",
            external_id=str(m["divera_id"]),
            metadata={"first_name": m["first_name"], "last_name": m["last_name"]},
        )
    deactivated = 0
    if deactivate_stale:
        for item in diff["stale"]:
            by_id[item["id"]].is_active = False
            deactivated += 1

    return {
        "created": len(diff["new"]),
        "updated": len(diff["updated"]),
        "reactivated": reactivated,
        "unchanged": len(diff["unchanged"]),
        "deactivated": deactivated,
        "stale": len(diff["stale"]),
    }


def sync_detail(result: dict, *, trigger: str, level: AutoSyncLevel | None = None) -> dict:
    """What a run of the sync says on the System card — the ``connector_states.detail`` payload.

    ``staleOutstanding`` is the number this card exists for: at level ``"safe"`` the members who
    have left Divera are counted and left active, so the surface can nudge («N Abgänge warten»)
    instead of the departures sitting in the roster unremarked. At ``"full"`` the same run
    already deactivated them, so it is zero — the outstanding ones, not the found ones.
    """
    return {
        "trigger": trigger,  # 'scheduled' | 'manual'
        "level": level,  # the autoSync level a scheduled run applied; null for a manual one
        "added": result["created"],
        "updated": result["updated"],
        "reactivated": result["reactivated"],
        "deactivated": result["deactivated"],
        "staleOutstanding": result["stale"] - result["deactivated"],
    }


async def auto_sync(db: AsyncSession) -> dict | None:
    """The unattended Mannschaft sync, at whatever level the station asked for.

    Returns the applied counts plus the ``level`` they were applied at, or ``None`` when there
    was nothing to do — level ``"off"``, or no Divera key. Both are ordinary states rather than
    failures: the job is registered unconditionally (see ``scheduler``) precisely so that a key
    pasted into Verwaltung this afternoon is synced tonight, without a restart.

    Deliberately the SAME apply path as «Mannschaft synchronisieren» — a second implementation
    of «which members does this station now have» is how the two would eventually disagree.
    """
    level = await load_roster_auto_sync(db)
    if level == "off":
        return None
    if not (credential("divera_personnel_access_key") or credential("divera_access_key")):
        return None
    result = await execute_sync(db, deactivate_stale=level == "full")
    return {"level": level, **result}
