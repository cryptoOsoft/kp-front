"""Integration credentials a station can set from a browser, encrypted at rest.

WHY THIS EXISTS
---------------
Every integration this app talks to — Divera, Traccar, Web Push, speech-to-text, the two
webhook intakes, the print agent, the dead-man's-switch — used to be reachable only by
editing ``.env`` and restarting the container. ``settings = Settings()`` is built once at
boot and there is no reload path, so a browser form that wrote ``.env`` would be a lie: the
process cannot restart itself into new environment, and several scheduler jobs were
*registered or not registered* at that same moment. The values therefore have to live
somewhere the running process can re-read, which means the database.

THE SHAPE, AND WHY EACH PART OF IT
----------------------------------
* **Its own table, never ``deployment_config.config_json``.** ``GET /api/config`` is public
  (the login screen brands itself before anybody logs in) and the Sicherung export/import
  round-trip replaces that document wholesale. A credential in there would make the export a
  leak and the import a credential-deletion button. Same reasoning the three existing
  station secrets follow (``capture_secret``, ``stats_secret``, ``incident_link_key`` are
  columns, not document fields) — this is that decision, one table further along because
  there are seventeen of them and they carry their own «changed when, by whom».

* **Encrypted with a key derived from ``SECRET_KEY``, which stays in ``.env``.** A stolen
  database dump — the nightly ``pg_dump``, the pre-migration safety dump, a laptop with a
  restore on it — is useless without the environment file that was never in it. HKDF-SHA256
  with a fixed info string gives this use its own key rather than reusing the one that
  peppers PINs and signs admin sessions; AES-256-GCM is authenticated, so a tampered row
  fails loudly instead of decrypting to garbage. The credential's own name is the AAD, so a
  row copied over another row's ciphertext does not silently move a value between slots.

  ⚠️ The cost is real and is stated in the docs: rotating ``SECRET_KEY`` now makes stored
  credentials unreadable as well as every PIN. That is the same failure class the docs
  already treat as never-rotate — but it must be *legible*, so an undecryptable value is
  reported as ``unreadable`` («bitte neu setzen»), never as ``unset`` and never as a 500.

* **``.env`` still wins where it is set.** An existing deployment changes behaviour not at
  all and nothing is migrated out of its environment: if the variable carries a value, that
  value is what every consumer gets and the admin UI shows it as server-set rather than as
  an editable box. Only a station that left the variable blank can set it from a browser.

* **Write-only over the API for anything secret.** An admin session can rotate a credential
  and cannot read one back. The page shows «gesetzt · geändert am …», never the value.

READ PATH
---------
Consumers must never snapshot these at import time — that is the boot-time trap this change
exists to remove. They read through :func:`get`, which serves a process-wide snapshot that
:func:`load` refreshes from the database when it is older than :data:`CACHE_TTL_SECONDS`
(the same shape ``geocode._resolve_bias`` uses for the geocoder bias). A write refreshes it
immediately, so a credential set in the browser reaches its consumer on the next request
rather than at the next restart; a 30 s scheduler refresh covers any reader that never gets
a session of its own.
"""

# **Integration credentials are settable from `/admin`, encrypted, and read through an
# accessor — never off `settings`.** Divera / Traccar / VAPID / STT / CARTO / the two webhook secrets /
# the print-agent secret / `HEALTHCHECK_PING_URL` live in `integration_credentials`
# (AES-256-GCM under an HKDF key derived from `SECRET_KEY`, which stays in `.env`), and every
# consumer reads `app.credentials.get(name)` after `await load(db)`. **`.env` still wins where
# it is set**, so no existing deployment changes. Two rules for anything added here: a
# scheduler job whose credential is runtime-settable is **registered unconditionally and
# no-ops when unset** (gating registration at boot is what made this impossible before), and
# a secret is **write-only over the API** — settable, never readable. The CARTO basemap key is
# the explicit client-credential exception: CARTO requires it in browser tile URLs, so it is
# readable at runtime and must be restricted to deployment domains at the provider. The
# authenticated organizer catalogue also shares this browser key for its route map; allow
# that organizer's domain at CARTO too. ⚠️ Readable
# is not public — `/api/config` serves it only to a caller holding a session, and «session»
# includes an incident LINK (`LinkApp` mounts the whole app, and a link carries no
# `access_token`, so `actor is not None` is the wrong test). Server-side renders (Rapport/Kroki)
# use `app/carto.py` and the deployment's own credential, never the client's copy. `SECRET_KEY`,
# `ADMIN_SECRET` and `REQUIRE_PLAN_DIGEST` stay env-only on purpose: each would defeat itself
# in the database it gates.

from __future__ import annotations

import ipaddress
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Literal

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, settings

logger = logging.getLogger(__name__)

Source = Literal["env", "stored", "unset", "unreadable"]


# --- The registry -------------------------------------------------------------------


@dataclass(frozen=True)
class CredentialField:
    """One settable credential: where it comes from, and whether it may be read back.

    ``name`` is deliberately the ``Settings`` attribute name, so the env fallback, the env
    variable name and the DB key are one string and cannot drift apart.
    """

    name: str
    group: str
    #: ``True`` → the value NEVER leaves this process through the API. ``False`` → the admin
    #: UI may display and prefill it. The split is per field and justified per field below.
    secret: bool
    #: Human-facing German label for the audit list and error messages.
    label: str

    @property
    def env(self) -> str:
        return self.name.upper()

    @property
    def declared(self) -> bool:
        """Does ``Settings`` carry this field?

        ⚠️ Not every credential has an ``.env`` twin any more. The ones that predate this table
        do — they were environment variables first — but a credential introduced AFTER it (the
        SharePoint app registration) has no reason to add a boot-time setting nobody sets, and
        adding one would put a value in a place with no reload path. An undeclared field is
        therefore read straight off the environment instead (see :func:`_env_value`), so a
        deployer who exports the variable still wins, and a station that does not still gets
        the browser form.
        """
        return self.name in Settings.model_fields

    @property
    def default(self) -> str:
        raw = Settings.model_fields[self.name].default if self.declared else ""
        return str(raw or "").strip()


#: Exactly the set a station may set from a browser. Everything NOT here stays in ``.env``
#: on purpose, and the admin page says so out loud: ``SECRET_KEY`` peppers the PINs in the
#: database it would live in, ``ADMIN_SECRET`` gates writing the very document it would live
#: in, ``REQUIRE_PLAN_DIGEST`` guards the config a stale publish overwrites, and the
#: database/port/domain variables are read before a database connection exists.
FIELDS: tuple[CredentialField, ...] = (
    # --- Divera -----------------------------------------------------------------------
    CredentialField("divera_access_key", "divera", True, "Divera Accesskey"),
    CredentialField("divera_personnel_access_key", "divera", True, "Divera Accesskey (Personal)"),
    CredentialField("divera_webhook_secret", "divera", True, "Divera Webhook-Secret"),
    # --- Traccar ----------------------------------------------------------------------
    # The URL is readable: it is a hostname, the admin System card already prints it, and an
    # operator who cannot see which server is configured cannot tell a typo from an outage.
    CredentialField("traccar_url", "traccar", False, "Traccar-Server"),
    # The e-mail is NOT readable. It is half of a credential pair, and the only thing knowing
    # it buys anybody is the other half — there is no diagnostic question it answers that
    # «gesetzt» does not.
    CredentialField("traccar_email", "traccar", True, "Traccar-Benutzer"),
    CredentialField("traccar_password", "traccar", True, "Traccar-Passwort"),
    # --- Web Push ---------------------------------------------------------------------
    # The public half is public by definition — /api/push/vapid-key already hands it to every
    # logged-in browser, so withholding it here would be theatre.
    CredentialField("vapid_public_key", "push", False, "VAPID Public Key"),
    CredentialField("vapid_private_key", "push", True, "VAPID Private Key"),
    # A contact address for the push service, printed in every push claim. Not a secret.
    CredentialField("vapid_subject", "push", False, "VAPID-Kontakt"),
    # --- Speech-to-text ---------------------------------------------------------------
    CredentialField("stt_base_url", "stt", False, "STT-Server"),
    CredentialField("stt_api_key", "stt", True, "STT-API-Key"),
    CredentialField("stt_model", "stt", False, "STT-Modell"),
    CredentialField("stt_language", "stt", False, "STT-Sprache"),
    # --- Map tiles --------------------------------------------------------------------
    # CARTO requires this value in every browser tile URL. It therefore is not a server
    # secret; CARTO's domain restrictions are the protection against reuse elsewhere.
    CredentialField("carto_api_key", "maps", False, "CARTO Basemap API-Key"),
    # --- Webhooks + relay -------------------------------------------------------------
    CredentialField("alarm_webhook_secret", "webhooks", True, "Alarm-Webhook-Secret"),
    CredentialField("print_agent_secret", "webhooks", True, "Print-Agent-Secret"),
    # --- Monitoring -------------------------------------------------------------------
    # ⚠️ Write-only, deliberately, even though it is barely a secret to this deployment.
    # api/system reports it as a BOOLEAN with the same reasoning: the ping address is a write
    # endpoint for an external monitor, and anyone who has it can ping it — i.e. keep the
    # monitor believing a dead station is alive. That is the one attack this URL enables, and
    # putting it on a screen is how it leaks.
    CredentialField("healthcheck_ping_url", "monitoring", True, "Monitor-Ping-URL"),
    # --- SharePoint pull connector ----------------------------------------------------
    # An Azure app registration in the STATION's tenant, client-credentials flow, read-only.
    # The two ids are READABLE and the secret is not, and that split is the point of the page:
    # «is this the right app registration?» is a question an operator has to answer off the
    # screen (they are comparing it against the Azure portal), and neither id is usable
    # without the secret. The secret itself is write-only like every other one.
    CredentialField("sharepoint_tenant_id", "sharepoint", False, "Azure Tenant-ID"),
    CredentialField("sharepoint_client_id", "sharepoint", False, "Azure Client-ID"),
    CredentialField("sharepoint_client_secret", "sharepoint", True, "Azure Client-Secret"),
    # ⚠️ Not a credential — a DATE, and the one that decides whether this connector still works
    # in two years. Azure caps a client secret at 24 months and says nothing when it expires;
    # the station finds out because plans stopped arriving. Kept beside the secret so the
    # System page can warn WEEKS ahead instead of reporting an auth failure afterwards.
    CredentialField("sharepoint_secret_expires", "sharepoint", False, "Client-Secret läuft ab"),
    # --- Objektbesuche ----------------------------------------------------------------
    # The organizer's bearer key for /api/integrations (docs/object-visits.md). Write-only like
    # every secret: the admin generates it, hands it to the organizer once, and can only rotate.
    CredentialField("object_visits_integration_key", "object_visits", True, "Organizer-Schlüssel"),
    # --- Station index (docs/CONFIGURATION.md §4d) -------------------------------------
    # ONE address for all the station's published data (owner decision X6/X7): an index.json
    # listing roster/vehicles/… by kind with checksums. Same rules as the roster source below,
    # which stays as the fallback for stations that set it before the index existed.
    CredentialField("station_index_source", "station_index", False, "Stationsdaten-Index"),
    CredentialField("station_index_token", "station_index", True, "Stationsdaten-Token"),
    # --- Roster snapshot (docs/CONFIGURATION.md §4c) -----------------------------------
    # WHERE the station's published roster file lives: an https:// address, or an absolute
    # path on this server (self-hosted: a file a script drops next to the stack). Readable,
    # like the Traccar URL — «is it pointing at the right file?» is a question an operator
    # answers off the screen. Anything secret belongs in the token, not in the address.
    CredentialField("roster_snapshot_source", "roster_snapshot", False, "Personenstamm-Quelle"),
    # Sent as `Authorization: Bearer …`, and only over https (roster_snapshot_ingest.read_source).
    CredentialField("roster_snapshot_token", "roster_snapshot", True, "Personenstamm-Token"),
    # --- SharePoint EXPORT (Objektbesuche delivery) -----------------------------------
    # ⚠️ A SECOND app registration, separate from the pull's on purpose: the pull is promised
    # read-only (`Sites.Selected` READ), and the delivery needs WRITE on one site. Sharing one
    # registration would mean granting the importer write access it must never have.
    CredentialField("sharepoint_export_tenant_id", "sharepoint_export", False, "Azure Tenant-ID (Ablage)"),
    CredentialField("sharepoint_export_client_id", "sharepoint_export", False, "Azure Client-ID (Ablage)"),
    CredentialField("sharepoint_export_client_secret", "sharepoint_export", True, "Azure Client-Secret (Ablage)"),
    # --- «Mit Microsoft anmelden» (optional, auth/microsoft) --------------------------------
    # A THIRD app registration: sign-in (delegated `openid profile`), nothing else. Neither
    # SharePoint registration is reused — those are app-only and must never sign a person in.
    # The allow-list is readable on purpose: «who may get in this way» is exactly what an admin
    # has to be able to check on the screen. Format: `objectid=username, …` (auth/microsoft).
    CredentialField("entra_login_tenant_id", "microsoft_login", False, "Azure Tenant-ID (Anmeldung)"),
    CredentialField("entra_login_client_id", "microsoft_login", False, "Azure Client-ID (Anmeldung)"),
    CredentialField("entra_login_client_secret", "microsoft_login", True, "Azure Client-Secret (Anmeldung)"),
    CredentialField("entra_login_accounts", "microsoft_login", False, "Zugelassene Microsoft-Konten"),
)

BY_NAME: dict[str, CredentialField] = {f.name: f for f in FIELDS}


# --- Encryption ---------------------------------------------------------------------

#: Bumped only if the scheme itself changes; every stored blob carries it as its first byte
#: so an old row stays readable across such a change.
SCHEME_VERSION = 1
_NONCE_BYTES = 12
#: Fixed HKDF info string. Changing it invalidates every stored credential — don't.
_HKDF_INFO = b"kp-front/integration-credentials/v1"


class UndecryptableCredentialError(Exception):
    """The stored bytes cannot be opened with this deployment's SECRET_KEY.

    Almost always means the key was rotated. Callers must surface this as «unlesbar, bitte
    neu setzen» — never as «nicht konfiguriert», which would send an operator looking for a
    setting they already made, and never as a 500.
    """


@lru_cache(maxsize=1)
def _key() -> bytes:
    """The credential key: HKDF-SHA256(SECRET_KEY), never SECRET_KEY itself.

    Separate key material for a separate job, so a value that leaks through one of these
    ciphertexts says nothing about the PIN pepper or the admin-session signer. Cached
    because ``SECRET_KEY`` cannot change inside a process (``lru_cache`` gives tests a
    ``_key.cache_clear()`` when they pretend otherwise).
    """
    return HKDF(algorithm=SHA256(), length=32, salt=None, info=_HKDF_INFO).derive(settings.secret_key.encode("utf-8"))


def seal(name: str, plaintext: str) -> bytes:
    """version ‖ nonce ‖ AES-256-GCM(plaintext, aad=name). Fresh nonce per write."""
    nonce = os.urandom(_NONCE_BYTES)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode("utf-8"), name.encode("utf-8"))
    return bytes([SCHEME_VERSION]) + nonce + ct


def unseal(name: str, blob: bytes) -> str:
    """Inverse of :func:`seal`. Raises :class:`UndecryptableCredentialError` on ANY failure —
    wrong key, truncated row, a value moved into another credential's slot."""
    try:
        if not blob or blob[0] != SCHEME_VERSION:
            raise ValueError(f"unknown credential scheme version {blob[:1]!r}")
        nonce, ct = blob[1 : 1 + _NONCE_BYTES], blob[1 + _NONCE_BYTES :]
        return AESGCM(_key()).decrypt(nonce, ct, name.encode("utf-8")).decode("utf-8")
    except (InvalidTag, ValueError, IndexError, UnicodeDecodeError) as e:
        raise UndecryptableCredentialError(name) from e


# --- Resolution ---------------------------------------------------------------------


@dataclass(frozen=True)
class Resolved:
    """What a credential currently is, and where it came from."""

    name: str
    source: Source
    #: The value a CONSUMER should use. Empty for `unset` secrets, the field default for the
    #: three that have one (STT model/language, VAPID subject), empty for `unreadable` —
    #: an unreadable credential must behave exactly like a missing one, loudly labelled.
    value: str
    updated_at: datetime | None = None
    updated_by: uuid.UUID | None = None


def _env_value(field: CredentialField) -> str | None:
    """The value ``.env``/compose supplied for this field, or None if it supplied none.

    ⚠️ «Supplied none» is not «absent from ``os.environ``». ``docker-compose.yml`` names every
    one of these variables and materialises the application's own default for two of them
    (``STT_MODEL``, ``STT_LANGUAGE``), so every compose deployment has them set to a value
    nobody chose. (``VAPID_SUBJECT`` used to be a third; compose now deliberately leaves it
    blank for exactly this reason.) Treating a materialised fallback as a deployer decision
    would lock those fields out of the admin UI on every single install. So the test is
    *differs from the declared default*: a deployer who typed something wins, a compose
    fallback does not.

    A field ``Settings`` does not declare (see :attr:`CredentialField.declared`) is read
    straight off ``os.environ``: there is no boot-time attribute to compare against and
    nothing materialises a fallback for it, so «present and non-empty» IS a deployer decision.
    """
    if not field.declared:
        raw = str(os.environ.get(field.env, "") or "").strip()
        return raw or None
    raw = str(getattr(settings, field.name, "") or "").strip()
    return raw if raw and raw != field.default else None


#: How long the STORED half of a credential may be stale. Short, because the whole point is
#: that a credential set in a browser takes effect without a restart — and cheap, because a
#: refresh is one scan of a seventeen-row table. Writes refresh immediately anyway; this bounds
#: the staleness for a second process (or a synchronous reader between requests).
CACHE_TTL_SECONDS = 30.0

#: ⚠️ Only the DATABASE half is cached. The environment half is re-read on every access
#: (``_env_value`` is a ``getattr`` on the boot-time settings object — no I/O), because
#: «.env wins» must not be something that becomes true up to thirty seconds later. It also
#: keeps the precedence rule in ONE place instead of duplicating it into a cache-fill.
_stored: dict[str, Resolved] = {}
_loaded_at: float | None = None

#: How long a FAILED lookup is remembered before another is attempted. Short enough that a
#: database that comes back is picked up promptly, long enough that a permanently missing table
#: costs one query per window instead of one per request. See the warning in :func:`load`.
RETRY_AFTER_FAILURE_SECONDS = 5.0
_failed_at: float | None = None


def _read_rows(rows: dict[str, tuple[bytes | None, datetime | None, uuid.UUID | None]]) -> dict[str, Resolved]:
    """Decrypt what the table holds. Only names with a row appear in the result."""
    out: dict[str, Resolved] = {}
    for f in FIELDS:
        row = rows.get(f.name)
        blob, updated_at, updated_by = row if row is not None else (None, None, None)
        if blob is None:
            continue
        try:
            out[f.name] = Resolved(f.name, "stored", unseal(f.name, blob), updated_at, updated_by)
        except UndecryptableCredentialError:
            # Loud once per refresh, and never with anything from the row in it.
            logger.warning(
                "Integration credential %r cannot be decrypted with this SECRET_KEY — "
                "reported as unreadable; it must be set again in /admin",
                f.name,
            )
            out[f.name] = Resolved(f.name, "unreadable", "", updated_at, updated_by)
    return out


async def load(db: AsyncSession | None = None, *, force: bool = False) -> dict[str, Resolved]:
    """Refresh the stored half when it is stale (or when forced); return the full state.

    Pass the request's session where there is one — that keeps this to a single extra query
    on a cold cache and nothing at all on a warm one. With no session it opens its own, the
    way ``geocode._resolve_bias`` does, so the scheduler and the boot path can call it too.

    Never raises: a database that is down leaves the previous values in place (and, on a cold
    start, none at all — every consumer then behaves as «not configured», which is the same
    fail-closed state they have always had).

    ⚠️ «NEVER RAISES» IS NOT ENOUGH ON POSTGRES, and getting that wrong took down the login
    screen. A failed statement puts the whole transaction into ``current transaction is aborted``
    — so swallowing the exception here left the CALLER's session dead, and the next
    ``db.execute`` (outside this function's try) raised ``PendingRollbackError``.
    ``api/config.get_config`` calls this on its first line and queries on its second, and that
    endpoint is PUBLIC: the trigger is as ordinary as restoring a dump taken before this table
    existed, after which the station's login screen answers 500 and names neither cause. It was
    invisible in the suite because the local gate runs on SQLite, which does not abort a
    transaction on a statement error; only the Postgres CI job would have seen it.

    So the query runs inside a SAVEPOINT when it is somebody else's session. Rolling that back
    undoes exactly this statement and leaves the surrounding transaction usable — which is the
    actual promise the caller needs, and the one the docstring used to imply.
    """
    global _stored, _loaded_at, _failed_at
    now = time.monotonic()
    stale = _loaded_at is None or now - _loaded_at >= CACHE_TTL_SECONDS
    # ⚠️ A failure must not retry on EVERY request. `_loaded_at` stays None when the lookup
    # fails, so without this a broken table meant one doomed query (and one savepoint) per
    # request forever, rather than one per refresh window.
    if not force and _failed_at is not None and now - _failed_at < RETRY_AFTER_FAILURE_SECONDS:
        return {f.name: resolved(f.name) for f in FIELDS}
    if force or stale:
        rows: dict[str, tuple[bytes | None, datetime | None, uuid.UUID | None]] = {}
        ok = True
        try:
            from .models import IntegrationCredential

            stmt = select(
                IntegrationCredential.name,
                IntegrationCredential.value_encrypted,
                IntegrationCredential.updated_at,
                IntegrationCredential.updated_by,
            )
            if db is not None:
                # SAVEPOINT — see the warning above. The caller lent us its transaction and
                # must get it back in the state it lent it, whether or not this query works.
                async with db.begin_nested():
                    result = await db.execute(stmt)
            else:
                from .database import async_session_maker

                async with async_session_maker() as own:
                    result = await own.execute(stmt)
            for name, blob, updated_at, updated_by in result.all():
                rows[name] = (blob, updated_at, updated_by)
        except Exception as e:  # noqa: BLE001 — a credential lookup must never break a request
            logger.warning("Integration credential lookup failed; keeping the previous values: %s", e)
            ok = False
        if ok:
            _stored = _read_rows(rows)
            _loaded_at = now
            _failed_at = None
        else:
            _failed_at = now
    return {f.name: resolved(f.name) for f in FIELDS}


def invalidate() -> None:
    """Force the next :func:`load` to hit the database (called after every write)."""
    global _loaded_at, _failed_at
    _loaded_at = None
    _failed_at = None


def reset_cache() -> None:
    """Drop everything cached — the stored values AND the derived key. For tests only."""
    global _stored, _loaded_at, _failed_at
    _stored = {}
    _loaded_at = None
    _failed_at = None
    _key.cache_clear()


def resolved(name: str) -> Resolved:
    """The full state of one credential: environment first, then whatever is stored.

    This function IS the precedence rule, and every reader goes through it.
    """
    f = BY_NAME[name]
    env = _env_value(f)
    if env is not None:
        return Resolved(name, "env", env)
    stored = _stored.get(name)
    if stored is not None:
        return stored
    return Resolved(name, "unset", f.default)


def get(name: str) -> str:
    """The effective value of one credential — the one a CONSUMER should use.

    Synchronous on purpose: ``push_enabled()``, the Traccar client and the provider registry
    are read from places that have no session to hand. The environment half is always live;
    the stored half is as fresh as the last :func:`load`, which every request path in this
    codebase awaits on the way in.
    """
    if name not in BY_NAME:
        return ""
    return resolved(name).value


# --- Writing ------------------------------------------------------------------------


class CredentialRefusedError(ValueError):
    """The value was rejected before it was ever stored (German message for the operator)."""


_PRIVATE_SUFFIXES = (".local", ".lan", ".internal", ".home.arpa")


def _is_packed_ip(label: str) -> bool:
    """Is this dotless label an IP address written as one integer? («134744072», «0x08080808»)

    Resolvers accept both — they are 8.8.8.8 — and neither is a hostname anybody types on
    purpose. A real LAN name never parses as an integer.
    """
    try:
        int(label, 16 if label.startswith("0x") else 10)
    except ValueError:
        return False
    return True


def _is_local_host(host: str) -> bool:
    """Is this hostname unambiguously on the station's own network?

    Used for ONE decision: whether plain ``http://`` is still allowed for an outbound URL an
    admin typed. ⚠️ It is NOT an SSRF control and must not be read as one — ``https://`` to any
    address, internal or not, is allowed by design, so this narrows the scheme and nothing else.
    The real control on where this deployment may be pointed is who holds ``ADMIN_SECRET``.

    ⚠️ Rewritten onto :mod:`ipaddress` because the hand-rolled version was wrong in ways that
    all failed OPEN, and its docstring claimed the opposite («anything it cannot place is
    treated as the public internet»). Every one of these was accepted as «local»:

        http://[2001:4860:4860::8888]   every IPv6 literal — no dot, so the «bare LAN name»
                                        branch swallowed the whole address family
        http://134744072                8.8.8.8 in decimal, which resolvers accept
        http://0x08080808               the same in hex
        http://010.0.0.1                reads as 10.0.0.1 here (`int("010") == 10`) and
                                        resolves as 8.0.0.1 (inet_aton parses it as octal)

    Parsing the literal properly answers all four at once, and the ambiguous forms are refused
    outright rather than guessed at.

    169.254.0.0/16 is deliberately NOT local any more. It is where the cloud metadata service
    lives, and no station's Whisper box or print agent has ever been on a link-local address —
    it is an address you get when DHCP has FAILED. Nothing legitimate is lost by refusing it.
    """
    h = host.lower().strip("[]")
    if not h:
        return False
    try:
        # `ip_address` accepts only the unambiguous dotted-quad / IPv6 forms — «010.0.0.1»,
        # «0x08080808» and «134744072» all raise, and a refusal means «not local», i.e. https.
        ip = ipaddress.ip_address(h)
    except ValueError:
        if h == "localhost" or h.endswith(_PRIVATE_SUFFIXES):
            return True
        # A bare LAN name («whisper», «pi») — but NOT a packed integer. `134744072` and
        # `0x08080808` are both 8.8.8.8 to a resolver and neither has a dot, so the plain
        # «no dot means LAN» test waved the public internet through in two notations.
        return "." not in h and not _is_packed_ip(h)
    # ⚠️ `is_private` INCLUDES 169.254.0.0/16 and fe80::/10, so link-local is subtracted back
    # out explicitly — see the metadata-service note above. Loopback is not link-local.
    return ip.is_loopback or (ip.is_private and not ip.is_link_local)


def _require_url(name: str, v: str, *, https_only: bool, message: str) -> str:
    """Normalise a URL credential, and decide whether plain http may be used.

    ⚠️ THE THREAT THIS CLOSES. These two URLs are outbound destinations the SERVER talks to —
    the STT one receives every voice memo an editor transcribes. Before this change only
    somebody with shell on the host could point them anywhere; now an admin session can, and a
    stolen tablet with /admin unlocked is a plausible way to hold one. Requiring https for
    anything off the station's own network means that redirection at least cannot be a
    plaintext feed, while the documented self-hosted-whisper-on-the-LAN case (which is often
    http and has no certificate) keeps working. It is not a substitute for guarding
    ADMIN_SECRET; it removes the cheapest version of the attack.
    """
    from urllib.parse import urlsplit

    if not v.startswith(("https://", "http://")):
        raise CredentialRefusedError(message)
    host = urlsplit(v).hostname or ""
    if v.startswith("http://") and (https_only or not _is_local_host(host)):
        raise CredentialRefusedError(
            f"{message} Unverschlüsseltes http:// ist nur für einen Server im eigenen Netz erlaubt."
        )
    return v.rstrip("/")


def validate(name: str, value: str) -> str:
    """Normalise + sanity-check one value. Raises :class:`CredentialRefusedError` with a message
    an operator can act on.

    Deliberately thin. The point is to catch the mistakes that would otherwise present as
    «I set it and nothing happened» — a Traccar URL over plain http (``TraccarClient`` pins
    https and would silently stay unconfigured), a base URL with the ``/v1`` suffix the STT
    adapter appends itself — not to validate a credential's contents, which only the far end
    can do. That is what the connection-test buttons are for.
    """
    v = value.strip()
    if not v:
        raise CredentialRefusedError("Der Wert darf nicht leer sein.")
    if len(v) > 2048:
        raise CredentialRefusedError("Der Wert ist zu lang (maximal 2048 Zeichen).")
    if "\n" in v or "\r" in v:
        raise CredentialRefusedError("Der Wert darf keine Zeilenumbrüche enthalten.")
    if name == "traccar_url":
        # https always — `TraccarClient.is_configured` pins it, so an http URL would store
        # fine and then do nothing at all, which is the failure shape this page exists to end.
        v = _require_url(
            name,
            v,
            https_only=True,
            message="Die Traccar-Adresse muss mit https:// beginnen – sonst bleibt die Ortung aus.",
        )
    if name == "stt_base_url":
        v = _require_url(name, v, https_only=False, message="Die STT-Adresse muss mit https:// beginnen.")
        if v.endswith("/v1"):
            raise CredentialRefusedError("Ohne «/v1» am Ende – das hängt die App selber an.")
    if name == "healthcheck_ping_url":
        v = _require_url(name, v, https_only=False, message="Die Ping-Adresse muss mit https:// beginnen.")
    if name in ("roster_snapshot_source", "station_index_source"):
        # A URL (https anywhere, plain http only inside the station's own network — the same
        # rule as the STT server), or an absolute path for a file on this host.
        if v.startswith(("https://", "http://")):
            v = _require_url(
                name, v, https_only=False, message="Die Quelle muss mit https:// beginnen oder ein absoluter Pfad sein."
            )
        elif not v.startswith(("file:///", "/")):
            raise CredentialRefusedError(
                "Die Quelle muss eine https://-Adresse oder ein absoluter Pfad sein (z. B. /data/roster.json)."
            )
    if name == "vapid_subject" and not v.startswith(("mailto:", "https://")):
        raise CredentialRefusedError("Der VAPID-Kontakt muss «mailto:…» oder «https://…» sein.")
    if name == "stt_language" and not (2 <= len(v) <= 8):
        raise CredentialRefusedError("Sprachcode wie «de» oder «de-CH».")
    if name in (
        "sharepoint_tenant_id",
        "sharepoint_client_id",
        "sharepoint_export_tenant_id",
        "sharepoint_export_client_id",
        "entra_login_tenant_id",
        "entra_login_client_id",
    ):
        # Both are GUIDs in the Azure portal. Checked because the alternative failure is a
        # 400 from a token endpoint half an hour later, in a log nobody is reading — and the
        # commonest paste here is the app's DISPLAY NAME, which is not a GUID at all.
        try:
            v = str(uuid.UUID(v))
        except ValueError as e:
            raise CredentialRefusedError(
                "Das ist keine GUID. Tenant- und Client-ID stehen im Azure-Portal unter "
                "«App-Registrierungen › Übersicht» und sehen aus wie "
                "«00000000-0000-0000-0000-000000000000»."
            ) from e
    if name == "entra_login_accounts":
        from .auth.microsoft import parse_accounts

        try:
            if not parse_accounts(v):
                raise ValueError(v)
        except ValueError as e:
            raise CredentialRefusedError(
                "Je Eintrag «Objekt-ID=Benutzername», getrennt durch Kommas – z. B. "
                "«0b6c1f2e-…=amuster». Die Objekt-ID steht in Entra unter «Benutzer › <Person> › "
                "Objekt-ID»; eine Anmeldeadresse gilt nicht, sie lässt sich umbenennen."
            ) from e
    if name == "print_agent_secret" and len(v) < 24:
        # It reads every queued Einsatzrapport-PDF from the internet-facing agent routes, so it
        # gets the same floor as the organizer key. `openssl rand -hex 24` makes 48.
        raise CredentialRefusedError("Das Secret muss mindestens 24 Zeichen lang sein.")
    if name == "object_visits_integration_key" and len(v) < 24:
        # A key an organizer authenticates with over the internet: long enough that guessing it
        # is not a plan. The admin page generates one; a hand-typed «fwo2026» is refused.
        raise CredentialRefusedError("Der Schlüssel muss mindestens 24 Zeichen lang sein.")
    if name == "sharepoint_secret_expires":
        from datetime import date

        try:
            v = date.fromisoformat(v).isoformat()
        except ValueError as e:
            raise CredentialRefusedError("Datum als JJJJ-MM-TT eintragen, z. B. 2028-03-31.") from e
    return v


async def set_value(
    db: AsyncSession,
    name: str,
    value: str,
    *,
    actor_id: uuid.UUID | None,
    source: str = "api",
) -> Resolved:
    """Store (or replace) one credential, encrypted, and record THAT it changed.

    Refuses while the environment supplies the same field: storing a value that ``.env``
    would then shadow is the «appears to work and changes nothing» failure this whole change
    exists to remove, and it is worse here than in a config file because the operator would
    have typed a live credential into a box that does nothing with it.
    """
    from .models import IntegrationCredential, IntegrationCredentialAudit

    f = BY_NAME.get(name)
    if f is None:
        raise CredentialRefusedError(f"Unbekannter Zugang «{name}».")
    if _env_value(f) is not None:
        raise CredentialRefusedError(
            f"«{f.label}» wird von der Server-Umgebung vorgegeben ({f.env} in .env) und lässt sich hier nicht ändern."
        )
    clean = validate(name, value)

    row = (
        await db.execute(select(IntegrationCredential).where(IntegrationCredential.name == name))
    ).scalar_one_or_none()
    action = "rotated" if row is not None and row.value_encrypted is not None else "set"
    blob = seal(name, clean)
    if row is None:
        db.add(IntegrationCredential(name=name, value_encrypted=blob, updated_by=actor_id))
    else:
        row.value_encrypted = blob
        row.updated_by = actor_id
        row.updated_at = datetime.now(UTC)
    db.add(IntegrationCredentialAudit(name=name, action=action, source=source, actor_id=actor_id))
    await db.flush()
    invalidate()
    await load(db, force=True)
    return resolved(name)


async def clear(db: AsyncSession, name: str, *, actor_id: uuid.UUID | None, source: str = "api") -> Resolved:
    """Delete one stored credential. Idempotent; still audited when there was nothing there,
    because «somebody tried to switch this off» is the interesting half of the record."""
    from sqlalchemy import delete

    from .database import execute_dml
    from .models import IntegrationCredential, IntegrationCredentialAudit

    f = BY_NAME.get(name)
    if f is None:
        raise CredentialRefusedError(f"Unbekannter Zugang «{name}».")
    if _env_value(f) is not None:
        raise CredentialRefusedError(
            f"«{f.label}» wird von der Server-Umgebung vorgegeben ({f.env} in .env) und lässt sich hier nicht ändern."
        )
    await execute_dml(db, delete(IntegrationCredential).where(IntegrationCredential.name == name))
    db.add(IntegrationCredentialAudit(name=name, action="cleared", source=source, actor_id=actor_id))
    await db.flush()
    invalidate()
    await load(db, force=True)
    return resolved(name)
