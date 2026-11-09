"""Web-Push sending (pywebpush) + the due-ness engine for killed-app alarms.

The in-app alarm layer (tone + SW notification) only works while the PWA is alive; a
swiped-away or OS-reclaimed app hears nothing. This module closes that gap server-side:
a scheduler job recomputes, every ~30s, which Atemschutz-Trupps are überfällig or at their
confirmed Alarmdruck and which Wiedervorlagen are due — from the SAME data the clients sync
(workspace trupps + journal reminder rows) with the SAME doctrine fallbacks — and pushes an
OS notification to subscribed browsers. A NEW Divera alarm additionally pushes
"Neuer Einsatz" immediately
(``notify_new_alarm``, called from both intake paths). Silently disabled while no VAPID
keys are configured.

Who hears what (owner's pick, 22.10.2026): the Atemschutz alarms go to every subscribed
browser; «Neuer Einsatz» only to editors (the accounts that take an alarm); «Wiedervorlage
fällig» to editors and the ``el`` (the record writers who can act on it). A viewer tablet is
woken for a crew in danger and for nothing else (``role_recipients``).

Deduplication: an alert is sent once per crossing (keyed by what defines the crossing — the
Trupp's lastContactTime, its lastPressureTime, or the reminder's effective dueAt) and re-sent
on a slow cadence while still due. State is in-memory: a restart re-notifies once, which is
the right failure direction for a safety alarm.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Collection
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    import requests

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .alarm_validation import (
    CONTACT_GRACE_SEC,
    CONTACT_INTERVAL_MIN,
    TruppStatus,
    finite_nonnegative,
    in_range,
    timestamp_ms,
    validate_reminder_row,
)
from .config import settings
from .models import Incident, JournalEntry, PushSubscription
from .transaction_hooks import after_commit

logger = logging.getLogger(__name__)

# What the push service said about one send. Only "accepted" is a real delivery — a "retry"
# (transient failure, e.g. 503) must NOT be recorded as delivered, or the renotify ledger would
# suppress that endpoint's next Atemschutz alarm for a whole window; "gone" (404/410) is pruned.
SendOutcome = Literal["accepted", "retry", "gone"]


def push_enabled() -> bool:
    """Whether this deployment can send Web Push at all.

    Reads through ``app.credentials`` (env first, admin-set otherwise) rather than off the
    boot-time settings object, so a station that generates a VAPID pair in the browser gets
    push on the next sweep instead of after a restart. Synchronous, because it is also read
    from the sending thread — the snapshot behind it is refreshed on every request path and
    every 30 s by the scheduler.
    """
    from .credentials import get as credential

    return bool(credential("vapid_private_key") and credential("vapid_public_key"))


# ---------------------------------------------------------------------------------------
# due-ness (pure, unit-tested — mirrors src/lib/atemschutz.ts + src/lib/reminders.ts)
# ---------------------------------------------------------------------------------------

DEFAULT_INTERVAL_MIN = 5
DEFAULT_GRACE_SEC = 60
DEFAULT_ALARM_BAR = 100
DEFAULT_ALARM_BAR_RUECKZUG = 50

#: How long a registration stays a delivery target without being renewed. The SPA re-subscribes on
#: every boot (src/lib/push.ts), so a row nobody has refreshed in half a year belongs to a browser
#: profile that is gone. Registration expires the user's stale rows; delivery ALSO excludes them
#: (`_deliverable`), so an expired row is never pushed to even before its owner next re-registers
#: (SEC-09, 05.09.). Lives here, the sending side, and is imported by the registration route.
SUBSCRIPTION_TTL_DAYS = 180

#: How long the push service keeps a message for a phone it cannot reach right now. The Atemschutz
#: and Wiedervorlage re-notifies keep 120 s (a stale «überfällig» is re-sent by the next sweep
#: anyway); «Neuer Einsatz» gets ~2 h with `Urgency: high`, so a phone in Doze or briefly out of
#: coverage still hears the dispatch when it wakes (3am sweep §1.2, 23.10.2026).
DEFAULT_TTL_SECONDS = 120
NEW_ALARM_TTL_SECONDS = 2 * 3600
NEW_ALARM_URGENCY = "high"


def _ms(iso: str | None) -> float | None:
    return timestamp_ms(iso)


#: the phases in which a Trupp is not in the field: no contact clock, no Alarmdruck
_NOT_IN_FIELD: tuple[TruppStatus, ...] = ("angemeldet", "raus")
#: the phase whose Alarmdruck is the lower Rückzug line
_RUECKZUG: TruppStatus = "rueckzug"


def due_trupps(workspace: dict, doctrine: dict, now_ms: float) -> list[dict[str, Any]]:
    """Trupps at frontend tier 2: an Atemschutznotfall, overdue contact or measured Alarmdruck.

    A Notfall (``notfallAt`` set — F1, 08.10.2026) wins over both, in the field or not, matching
    ``truppAlarm``: somebody HELD «Notfall» on that crew, and it ends only by «Notfall beendet».
    Pressure wins over contact when both apply: a radio check cannot resolve a crew at its
    Alarmdruck. The expected-pressure estimate is deliberately absent; it remains a
    Planungshilfe and never raises an alarm.

    Only Trupps under Atemschutz are considered — see the ``kind`` gate in the loop.
    """
    settings_ws = workspace.get("settings")
    settings_ws = settings_ws if isinstance(settings_ws, dict) else {}
    # Per-Einsatz override → station doctrine → shipped value, each only within the station range
    # (alarm_validation · CONTACT_INTERVAL_MIN), exactly as the board resolves it
    # (src/lib/workspace · sanitizeWorkspace drops an out-of-range override at load).
    interval_min = settings_ws.get("contactIntervalMin")
    if not in_range(interval_min, CONTACT_INTERVAL_MIN):
        interval_min = doctrine.get("contactIntervalMin")
    if not in_range(interval_min, CONTACT_INTERVAL_MIN):
        interval_min = DEFAULT_INTERVAL_MIN
    grace_sec = settings_ws.get("contactGraceSec")
    if not in_range(grace_sec, CONTACT_GRACE_SEC):
        grace_sec = doctrine.get("contactGraceSec")
    if not in_range(grace_sec, CONTACT_GRACE_SEC):
        grace_sec = DEFAULT_GRACE_SEC
    alarm_bar = doctrine.get("alarmBar")
    if alarm_bar is None:
        alarm_bar = DEFAULT_ALARM_BAR
    alarm_bar_rueckzug = doctrine.get("alarmBarRueckzug")
    if alarm_bar == 0:
        alarm_bar_rueckzug = 0
    elif alarm_bar_rueckzug is None:
        alarm_bar_rueckzug = DEFAULT_ALARM_BAR_RUECKZUG
    alarm_bar_rueckzug = min(alarm_bar_rueckzug, alarm_bar)
    out = []
    trupps = workspace.get("trupps")
    for t in trupps if isinstance(trupps, list) else []:
        if not isinstance(t, dict):
            continue
        # ⚠️ Trupps under PA only. A plain work squad (``kind: "einfach"`` — src/types.ts ·
        # TruppKind) has no cylinder and no Funkkontakt-Intervall, so neither reason below can
        # apply to it; without this gate its ``entryPressureBar`` of 0 sits at or below every
        # configured Alarmdruck and the sweep would push «Alarmdruck erreicht» for a Verkehrstrupp
        # every 30 s. Only an explicit ``einfach`` is exempt: absent (every Trupp recorded before
        # 03.09.) and any unknown word stay monitored — a typo must not switch the alarm off
        # (audit F01, 25.10.2026). Mirrors ``isAtemschutzTrupp`` in lib/atemschutz.ts.
        if t.get("kind") == "einfach":
            continue
        # the Notfall FIRST (src/lib/atemschutz · truppInNotfall): set, and the card not removed
        notfall_at = _ms(t.get("notfallAt"))
        if notfall_at and not t.get("removedAt"):
            out.append({"id": t.get("id"), "name": t.get("name") or "Trupp", "since": notfall_at, "reason": "notfall"})
            continue
        entry = _ms(t.get("entryTime"))
        if not entry or t.get("status") in _NOT_IN_FIELD or t.get("exitTime"):
            continue
        contact = _ms(t.get("lastContactTime")) or entry
        current_bar = t.get("lastPressureBar")
        if current_bar is None:
            current_bar = t.get("entryPressureBar")
        line = alarm_bar_rueckzug if t.get("status") == _RUECKZUG else alarm_bar
        pressure_due = (
            finite_nonnegative(current_bar)
            and isinstance(line, (int, float))
            and not isinstance(line, bool)
            and line > 0
            and current_bar <= line
        )
        contact_due = now_ms - contact >= (interval_min * 60 + grace_sec) * 1000
        if pressure_due or contact_due:
            # A Funkkontakt below the Alarmdruck must not look like a new pressure crossing.
            # A NEW confirmed Druckmeldung should, even if its value happens to be unchanged.
            pressure_at = _ms(t.get("lastPressureTime")) or entry
            out.append(
                {
                    "id": t.get("id"),
                    "name": t.get("name") or "Trupp",
                    "since": contact,
                    "reason": "pressure" if pressure_due else "contact",
                    **({"bar": current_bar, "line": line, "pressureAt": pressure_at} if pressure_due else {}),
                }
            )
    return out


def _atemschutz_message(alert: dict[str, Any]) -> tuple[str, str]:
    """German OS-notification copy matching the frontend tier-2 notification."""
    if alert["reason"] == "notfall":
        # copy · atemschutz.notfall.notifyTitle — the body carries no clock time: the server does
        # not know the station's time zone, and «seit» is on the card the tap opens
        return f"Atemschutz-Notfall – {alert['name']}", "Notfall ausgelöst – Sicherungstrupp einsetzen."
    if alert["reason"] == "pressure":
        bar = f"{alert['bar']:g}"
        line = f"{alert['line']:g}"
        return f"Alarmdruck erreicht – {alert['name']}", f"{bar} bar, Grenze {line} bar – Rückzug anordnen."
    return "Atemschutz überfällig", f"Trupp {alert['name']} überfällig – Kontakt herstellen."


def notfall_changes(previous: object, current: object) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The Atemschutznotfälle a save RAISED and ENDED — ``previous``/``current`` are the stored and
    the saved ``trupps`` lists (F1, 08.10.2026).

    Raised = a Trupp under Atemschutz on the board whose ``notfallAt`` is set now and was not set
    to that same moment before (a re-save of a running Notfall raises nothing). Ended = one whose
    ``notfallAt`` was set and is gone, the card still on the board. Each carries the alert shape
    ``due_trupps`` produces, so both paths key their crossing identically (``_notfall_key``).
    """

    def by_id(rows: object) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for t in rows if isinstance(rows, list) else []:
            if isinstance(t, dict) and isinstance(t.get("id"), str):
                out[t["id"]] = t
        return out

    before, after = by_id(previous), by_id(current)
    raised: list[dict[str, Any]] = []
    ended: list[dict[str, Any]] = []
    for tid, t in after.items():
        # only an explicit «einfach» is exempt, as in due_trupps — a typo must not drop a Notfall (F01)
        if t.get("kind") == "einfach" or t.get("removedAt"):
            continue
        at = _ms(t.get("notfallAt"))
        was = before.get(tid, {}).get("notfallAt")
        if at and t.get("notfallAt") != was:
            alert: dict[str, Any] = {"id": tid, "name": t.get("name") or "Trupp", "since": at, "reason": "notfall"}
            # ⚠️ a Notfall that was ALREADY running and only moved its trigger is the same one: two
            # devices held at once and the merge kept the earlier hold (mergeWorkspace · mergeTrupp).
            # It is announced already — its new crossing key is claimed, never sent (review of #300)
            if _ms(was):
                alert["moved"] = True
            raised.append(alert)
        elif not at and _ms(was):
            ended.append({"id": tid, "name": t.get("name") or "Trupp", "since": _ms(was), "reason": "notfall"})
    return raised, ended


def _notfall_key(incident_id: object, alert: dict[str, Any]) -> str:
    """The sweep's crossing key for a Notfall (``check_and_push``) — shared, so the immediate push
    on the save and the 30 s sweep after it never both announce the same Notfall."""
    return f"az:{incident_id}:{alert['id']}:{alert['since']}:{alert['reason']}"


async def notify_notfall_changes(db: AsyncSession, inc: Incident, previous: object, current: object) -> int:
    """Push a raised (and an ended) Atemschutznotfall the moment its save commits (F1).

    The sweep (``check_and_push``) re-derives every Notfall from the stored blob within 30 s —
    that stays the fallback (a failed send, a restart, a device that subscribed late). This is the
    fast path: a Notfall is the one alarm where 30 s matter. ⚠️ Deduplicated with the sweep by the
    SAME crossing key, claimed here before the send (``_should_send``): the sweep then finds it
    notified and only renotifies on its usual cadence. In-memory like the sweep's ledger, so a
    second replica could announce it once more — the safe direction. Not for an Übung or the demo
    (the sweep skips both too). Returns the pushes queued.
    """
    raised, ended = notfall_changes(previous, current)
    # …and never for a closed Einsatz (the sweep's own rule above): nobody can end it there
    if not (raised or ended) or not push_enabled() or inc.is_exercise or not inc.is_open:
        return 0
    from .alarms import is_demo_deployment

    if await is_demo_deployment(db):
        return 0
    factory = async_sessionmaker(db.bind, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    # title, body, Trupp id, the crossing key it claims, and whether that key is the sweep's
    sends: list[tuple[str, str, str, str, bool]] = []
    moved: list[str] = []
    for alert in raised:
        if alert.get("moved"):
            moved.append(_notfall_key(inc.id, alert))
            continue
        title, body = _atemschutz_message(alert)
        sends.append((title, body, alert["id"], _notfall_key(inc.id, alert), True))
    for alert in ended:
        # once per Notfall: the end of THIS trigger, never again for a re-save
        sends.append(
            (
                f"Notfall beendet – {alert['name']}",
                "Atemschutz-Notfall beendet.",
                alert["id"],
                f"az-end:{inc.id}:{alert['id']}:{alert['since']}",
                False,
            )
        )

    def schedule() -> None:
        # claimed AFTER the commit: a save that rolled back raised nothing, and must not leave a
        # claimed key behind that would keep the sweep quiet about a later, real one
        now_ms = datetime.now(UTC).timestamp() * 1000
        for key in moved:
            _should_send(key, now_ms)  # claimed, so the sweep does not announce it a second time
        # ⚠️ An END releases that Notfall's crossing key, and a RAISE releases its end key (review
        # of #300, CodeRabbit). ↶ on «Notfall beendet» — or on the «Raus» that ended it — restores
        # the ORIGINAL ``notfallAt``, so the re-raise carries the very key the first push claimed:
        # still inside its renotify window, ``_should_send`` dropped it, the sweep stayed quiet as
        # well, and every recipient's tray kept showing «Notfall beendet» over a crew that is in
        # distress again. The reverse is the same trap for a second «beendet» after that undo.
        for alert in ended:
            _release(_notfall_key(inc.id, alert))
        for alert in raised:
            if not alert.get("moved"):
                _release(f"az-end:{inc.id}:{alert['id']}:{alert['since']}")
        for title, body, trupp_id, key, swept in sends:
            if not _should_send(key, now_ms):
                continue
            task = asyncio.create_task(
                _broadcast_committed(
                    factory,
                    title=title,
                    body=body,
                    # the same tray entry as the alarm, so «beendet» replaces «Notfall»
                    tag=f"atemschutz-{trupp_id}",
                    target=f"atemschutz:{trupp_id}",
                    # the sweep's ledger only for the sweep's key: an undelivered «Notfall» is
                    # retried by the next sweep, an «beendet» has no sweep behind it
                    dedup_key=key if swept else None,
                )
            )
            _inflight.add(task)
            task.add_done_callback(_inflight.discard)

    after_commit(db, schedule)
    return len(sends)


def due_reminders(rows: list[dict], now_ms: float, closed_at: str | None) -> list[dict[str, Any]]:
    """Open, due Wiedervorlagen folded from journal rows (created/snoozed/done lifecycle);
    reminders due before the Einsatzende are expired by closure (mirrors deriveReminders)."""
    created: dict[str, dict] = {}
    latest: dict[str, dict] = {}
    for e in rows:  # oldest→newest (seq order)
        try:
            validate_reminder_row(e)
        except ValueError as exc:
            row_id = e.get("id") if isinstance(e, dict) else None
            row_id = row_id[:128] if isinstance(row_id, str) else None
            logger.warning("Skipping malformed legacy reminder row %r: %s", row_id, exc)
            continue
        r = e.get("reminder")
        if not r or not r.get("id"):
            continue
        if r.get("op") == "created":
            created[r["id"]] = e
            latest[r["id"]] = {"op": "created", "dueAt": r.get("dueAt")}
        else:
            prev = latest.get(r["id"], {})
            latest[r["id"]] = {"op": r.get("op"), "dueAt": r.get("dueAt") or prev.get("dueAt")}
    closed_ms = _ms(closed_at)
    out = []
    for rid, c in created.items():
        st = latest.get(rid)
        if not st or st["op"] == "done":
            continue
        due = st.get("dueAt") or (c.get("reminder") or {}).get("dueAt")
        due_ms = _ms(due)
        if due_ms is None:
            continue
        if closed_ms is not None and due_ms < closed_ms:
            continue  # expired by closure
        if due_ms <= now_ms:
            out.append({"id": rid, "text": c.get("text") or "Wiedervorlage", "dueAt": due})
    return out


# ---------------------------------------------------------------------------------------
# sending
# ---------------------------------------------------------------------------------------


#: Per-endpoint push timeout. pywebpush hands this to requests; without it the default is
#: None, i.e. wait forever. New-alarm delivery is detached after the intake COMMIT, but due
#: alarm sweeps still await a broadcast; every path needs a finite upper bound.
PUSH_TIMEOUT_SECONDS = 10

#: Sends in flight at once. The blocking sender runs on the default thread pool, which the rest
#: of the app shares — an unbounded fan-out over every subscribed browser is how a push sweep
#: starves the request path it was queued from.
BROADCAST_CONCURRENCY = 8

#: Wall clock for ONE broadcast. A per-endpoint timeout bounds one send; with more rows than
#: `BROADCAST_CONCURRENCY` the queue behind them is what an awaiting alarm actually waits for,
#: and an alarm that arrives late is the failure this whole module exists to prevent.
BROADCAST_DEADLINE_SECONDS = 45

# Strong references to post-commit tasks. asyncio itself holds only weak references.
_inflight: set[asyncio.Task] = set()

#: Strong references to the individual per-endpoint send tasks a broadcast fans out. The deadline
#: below deliberately does NOT cancel them (see `broadcast`), so this set — not the awaiting
#: gather — is what keeps a still-running send from being garbage-collected mid-flight. Each task
#: removes itself on completion.
_broadcast_tasks: set[asyncio.Task] = set()


#: Web-Push endpoints this server will POST to: the four major browser push services, matched as
#: host SUFFIXES (WNS and Apple shard by region — `sN.notify.windows.com`, `<region>.push.apple.com`
#: — so an exact set would reject real endpoints). Before this, ANY public-HTTPS host a logged-in
#: user registered became an outbound POST target, i.e. the alarm sender was a request forwarder
#: from the server's own network position. SEC-09 closes that by rejecting arbitrary hosts and
#: accepting only a known push service (plus the admin escape hatch below). Mirrors
#: kroki._TILE_PROVIDER_HOSTS — the two caller-chosen egress surfaces this app has.
_PUSH_SERVICE_HOSTS = frozenset(
    {
        "fcm.googleapis.com",  # Chromium / FCM
        "updates.push.services.mozilla.com",  # Firefox / Mozilla autopush
        "notify.windows.com",  # WNS: regional shards, e.g. sg2p.notify.windows.com
        "push.apple.com",  # Safari / WebKit: web.push.apple.com + regional *.push.apple.com
    }
)


def _push_extra_hosts() -> frozenset[str]:
    """Extra push-service hosts this deployment's operator configured (PUSH_EXTRA_HOSTS) — the
    escape hatch for a self-hosted push service. Env only, like REPORT_TILE_HOSTS: the endpoint
    arrives in a caller's request body, so who may add a destination is whoever runs the
    deployment, never whoever is logged in."""
    return frozenset(h.strip().lower() for h in settings.push_extra_hosts.split(",") if h.strip())


def is_known_push_host(host: str) -> bool:
    """Whether an endpoint host is a major push service (or an admin-allowlisted one). Suffix
    match on the DECODED, lower-cased host: the leading dot keeps a lookalike like
    `fcm.googleapis.com.evil.example` out, and decoding first means a `%xx`-encoded host is judged
    as what the transport will actually send it to — it can neither smuggle an arbitrary host past
    the allowlist nor hide a known one from it (SEC-09, 05.09.)."""
    from urllib.parse import unquote

    h = unquote((host or "").strip()).strip().strip("[]").rstrip(".").lower()
    if not h:
        return False
    return any(h == s or h.endswith(f".{s}") for s in _PUSH_SERVICE_HOSTS | _push_extra_hosts())


def _deliverable():
    """Subscriptions an alarm may go to: kiosk rows without a user, plus every ACTIVE user's.

    An outer join, not a filter on a joined column — a `user_id` of NULL is a legitimate row
    (a shared station browser that subscribed before it had a login) and an inner join would
    silently stop notifying it.

    Expired rows (past the TTL, never refreshed) are excluded here too: expiry ran only when a
    user re-registered, so a phone that stopped booting the app was still being POSTed to for
    months (SEC-09, 05.09.).
    """
    from .models import User

    cutoff = datetime.now(UTC) - timedelta(days=SUBSCRIPTION_TTL_DAYS)
    return (
        select(PushSubscription)
        .outerjoin(User, User.id == PushSubscription.user_id)
        .where(
            (PushSubscription.user_id.is_(None)) | (User.is_active.is_(True)),
            PushSubscription.created_at >= cutoff,
        )
    )


def _sendable(endpoint: str) -> bool:
    """Last gate before the sender: a row stored before the destination policy existed (or
    written by an older release) must not become an outbound request now. The policy DECODES the
    host before judging it, so a stored `https://%31%32%37.0.0.1/…` — which `requests` would
    normalise to loopback — is refused HERE rather than reaching 127.0.0.1 (SEC-09, 05.09.).

    Two gates, both re-checked here so registration cannot be the ONLY enforcement point: the
    endpoint must be public-HTTPS (`require_public_https`), and its host must be a known push
    service or admin-allowlisted (`is_known_push_host`). The send-path re-check is what stops a
    row written before SEC-09 — an arbitrary host that was accepted then — from being POSTed to now.

    Static checks only — no DNS on the alarm path (a sweep re-validates dozens of rows inline on
    the event loop, and registration is where resolution happens, app/api/push.py). Refusing an
    already-resolvable name that has since rebound INWARDS would need `resolve=True` here; that is
    left as the documented DNS-rebind residual (app/egress.py) and the `block_unresolved` seam."""
    from .egress import EgressRefusedError, require_public_https

    try:
        host = require_public_https(endpoint, what="Push-Endpunkt")
    except EgressRefusedError as e:
        logger.warning("Push-Endpunkt übersprungen (%s): %.60s", e, endpoint)
        return False
    if not is_known_push_host(host):
        logger.warning("Push-Endpunkt ist kein bekannter Push-Dienst — übersprungen: %.60s", endpoint)
        return False
    return True


def _no_redirect_session() -> "requests.Session":
    """A `requests` session that refuses to FOLLOW redirects.

    ⚠️ pywebpush uses a default session, which follows redirects — so a subscription on a validated
    public-HTTPS host that answers «301 → http://169.254.169.254» would have the encrypted body
    re-POSTed to that loopback/metadata target (SEC-09, 05.09.). The destination stays the endpoint
    registration and `_sendable` already vetted; a 3xx is simply not delivered (and not pruned — a
    redirecting push service is not a gone one). Redirects are separate from the accepted
    DNS-rebinding residual (app/egress.py); this closes them.
    """
    import requests

    session = requests.Session()

    def _no_redirects(resp, *_args, **_kwargs):  # requests calls this to build the redirect chain
        return iter(())

    session.resolve_redirects = _no_redirects  # type: ignore[method-assign]
    return session


def _send_one(sub: dict, payload: str, *, ttl: int = DEFAULT_TTL_SECONDS, urgency: str | None = None) -> SendOutcome:
    """Blocking pywebpush send. "accepted" = the push service took it; "gone" = the endpoint is
    dead (404/410) or its keys are unusable, so the caller prunes it; "retry" = a transient failure
    (e.g. 503) — keep the row and let the next sweep try again (never counted as delivered).
    ``ttl``/``urgency`` are the Web Push delivery hints (RFC 8030 §5.2/§5.3)."""
    from pywebpush import WebPushException, webpush

    from .credentials import get as credential

    try:
        webpush(
            subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
            data=payload,
            vapid_private_key=credential("vapid_private_key"),
            vapid_claims={"sub": credential("vapid_subject")},
            ttl=ttl,
            headers={"Urgency": urgency} if urgency else None,
            timeout=PUSH_TIMEOUT_SECONDS,
            requests_session=_no_redirect_session(),
        )
        return "accepted"
    except WebPushException as e:
        code = getattr(getattr(e, "response", None), "status_code", None)
        if code in (404, 410):
            return "gone"  # endpoint gone — caller prunes it
        logger.warning("Web push failed (%s): %s", code, e)
        return "retry"  # transient (503, timeout, …): NOT a delivery — retry next sweep
    except Exception:  # intake must survive a broken push path  # malformed keys must not abort the whole sweep
        logger.exception("Web push subscription unusable — pruning %s", sub["endpoint"][:60])
        return "gone"


async def broadcast(
    db: AsyncSession,
    *,
    title: str,
    body: str,
    tag: str,
    target: str | None,
    dedup_key: str | None = None,
    user_ids: Collection[uuid.UUID] | None = None,
    ttl: int = DEFAULT_TTL_SECONDS,
    urgency: str | None = None,
) -> int:
    """Push to every subscribed browser of an ACTIVE user; prunes dead endpoints.

    ``ttl`` and ``urgency`` go to the push service as delivery hints (``_send_one``): the new-alarm
    path asks for ~2 h and ``high``; the sweeps keep the short default.

    ``user_ids`` narrows the audience to those accounts' browsers (no kiosk rows): the
    «Neuer Objektbesuch» push goes to the accounts an admin picked, «Neuer Einsatz» and
    «Wiedervorlage fällig» to their roles (``role_recipients``). ``None`` = everybody, which
    only the Atemschutz alarms use. An empty collection sends nothing.

    Returns the number of sends that actually COMPLETED. A deactivated login keeps no delivery:
    the row survives (the person may come back) but the alarm does not follow an account somebody
    switched off.

    ``dedup_key`` ties this call to a sweep crossing (``check_and_push``). When given, the shared
    per-recipient ledger ``_delivered[dedup_key]`` is consulted so a browser already reached this
    round is skipped, and re-armed via ``_notified`` so a recipient still outstanding at the
    deadline is retried next sweep. The new-alarm path fires once and passes no key.
    """
    if user_ids is not None and not user_ids:
        return 0
    delivered_set = _delivered.setdefault(dedup_key, set()) if dedup_key is not None else None
    audience = _deliverable()
    if user_ids is not None:
        audience = audience.where(PushSubscription.user_id.in_(list(user_ids)))
    subs = [
        s
        for s in (await db.execute(audience)).scalars()
        if _sendable(s.endpoint) and not (delivered_set is not None and s.endpoint in delivered_set)
    ]
    if not subs:
        return 0
    payload = json.dumps({"title": title, "body": body, "tag": tag, "target": target})

    # Concurrently, not one after another. Sequentially the worst case was
    # len(subs) x PUSH_TIMEOUT_SECONDS — twenty subscribed devices with one dead push service
    # meant minutes of hanging, and this is awaited inline in the alarm intake path. Fanned
    # out, the whole sweep costs one timeout regardless of how many endpoints are unreachable.
    # Bounded on both axes: at most BROADCAST_CONCURRENCY threads, and the whole broadcast
    # STOPS WAITING at BROADCAST_DEADLINE_SECONDS rather than holding the alarm path open.
    gate = asyncio.Semaphore(BROADCAST_CONCURRENCY)

    async def send(s: PushSubscription) -> tuple[str, SendOutcome]:
        async with gate:
            outcome = await asyncio.to_thread(
                _send_one,
                {"endpoint": s.endpoint, "p256dh": s.p256dh, "auth": s.auth},
                payload,
                ttl=ttl,
                urgency=urgency,
            )
        return s.endpoint, outcome

    tasks = {asyncio.create_task(send(s)) for s in subs}
    _broadcast_tasks.update(tasks)

    def _record(task: asyncio.Task) -> None:
        _broadcast_tasks.discard(task)
        # Note only the recipients the push service ACCEPTED — even a send that finishes AFTER this
        # broadcast's deadline records here, so the next sweep skips it and never delivers twice. A
        # "retry" (transient failure) is deliberately NOT recorded, so the next sweep tries it again.
        # Closes over this round's exact set object: a later renotify round replaces it (see
        # `_should_send`), so a very-late completion cannot pollute the fresh round.
        if delivered_set is None or task.cancelled() or task.exception() is not None:
            return
        if task.result()[1] == "accepted":
            delivered_set.add(task.result()[0])

    for t in tasks:
        t.add_done_callback(_record)

    # ⚠️ The deadline STOPS WAITING; it does not cancel. Cancelling would (1) drop the WAIT on a
    # queued send whose recipient the renotify key already counts as notified — silently skipping
    # a safety alarm for a whole `push_renotify_seconds` window — and (2) abandon an already-
    # admitted `to_thread` send that keeps running on its thread anyway, which the next sweep
    # would then DUPLICATE. So the unfinished sends run to completion (kept alive by
    # `_broadcast_tasks`) and record themselves via `_record`; here we only collect what is done.
    done, pending = await asyncio.wait(tasks, timeout=BROADCAST_DEADLINE_SECONDS)

    delivered = 0
    dead: list[str] = []
    retryable = False  # a send that failed transiently (503, …) — retry it on the next sweep
    for task in done:
        if task.cancelled():
            continue
        exc = task.exception()
        if exc is not None:
            # _send_one already swallows everything it knows about; anything arriving here is
            # unexpected. Log it and KEEP the subscription — pruning on an unknown fault would
            # silently unsubscribe a working device.
            logger.warning("Web push raised unexpectedly: %s", exc)
            retryable = True
            continue
        endpoint, outcome = task.result()
        if outcome == "accepted":
            delivered += 1
        elif outcome == "gone":
            dead.append(endpoint)
        else:  # "retry": keep the row, don't count it, and re-arm the crossing below
            retryable = True
    if dead:
        # Only endpoints whose send finished before the deadline are pruned — a slow push service
        # is not a gone one, and a still-running send has no verdict yet.
        await db.execute(delete(PushSubscription).where(PushSubscription.endpoint.in_(dead)))
        logger.info("Pruned %d dead push subscription(s)", len(dead))
    if pending:
        logger.warning(
            "Push-Broadcast (%s): %d von %d Sendungen offen nach %ss",
            tag,
            len(pending),
            len(subs),
            BROADCAST_DEADLINE_SECONDS,
        )
    # Re-arm this crossing so the NEXT sweep retries the recipients still missing — those still
    # outstanding at the deadline (`pending`) AND those that failed transiently (`retryable`).
    # `_delivered` keeps the ones already ACCEPTED, so the retry goes only to the missing and
    # nobody is notified twice. Without this a 503'd device would wait a whole renotify window.
    if dedup_key is not None and (pending or retryable):
        _notified.pop(dedup_key, None)
    return delivered


#: The roles a «Neuer Einsatz» push reaches: the accounts that take an alarm into an Einsatz.
NEW_ALARM_ROLES = ("editor",)
#: The roles a «Wiedervorlage fällig» push reaches: the record writers, who can tick it off.
REMINDER_ROLES = ("editor", "el")


async def role_recipients(db: AsyncSession, roles: Collection[str]) -> list[uuid.UUID]:
    """The ACTIVE accounts holding one of ``roles`` — a push audience for ``broadcast(user_ids=…)``.

    Read when the push leaves, so a role an admin changed a minute ago already counts. A kiosk
    row (no user) is in no role and hears only the Atemschutz alarms, which go to everybody."""
    from .models import User

    rows = await db.execute(select(User.id).where(User.role.in_(list(roles)), User.is_active.is_(True)))
    return list(rows.scalars())


async def _new_alarm_recipients(db: AsyncSession) -> list[uuid.UUID]:
    return await role_recipients(db, NEW_ALARM_ROLES)


async def notify_new_alarm(
    db: AsyncSession, *, tag: str, title: str, address: str | None, target: str | None = "divera"
) -> int:
    """Queue a "Neuer Einsatz" push to the editors (``NEW_ALARM_ROLES``) after the alarm
    transaction commits.

    Delivery uses a fresh session, so dead-subscription pruning is committed independently
    and no task retains the request session. Returns 1 when queued, 0 when push is disabled.
    """
    if not push_enabled():
        return 0
    body = " — ".join(p for p in (title, address) if p) or "Alarmeingang"
    # Bind the fresh session to the caller's engine. This is the application engine in
    # production and the isolated engine under tests.
    factory = async_sessionmaker(db.bind, class_=AsyncSession, expire_on_commit=False, autoflush=False)

    def schedule() -> None:
        task = asyncio.create_task(
            _broadcast_committed(
                factory,
                title="Neuer Einsatz",
                body=body,
                tag=tag,
                target=target,
                audience=_new_alarm_recipients,
                ttl=NEW_ALARM_TTL_SECONDS,
                urgency=NEW_ALARM_URGENCY,
            )
        )
        _inflight.add(task)
        task.add_done_callback(_inflight.discard)

    after_commit(db, schedule)
    return 1


def notify_login_lock(db: AsyncSession, *, display_name: str, minutes: int, tag: str) -> None:
    """Tell the editors that new devices are now refused for one account (auth/router ·
    `_refuse_new_device`): somebody is guessing at its PIN. Scheduled at once, on its own
    session — the request that noticed is about to answer 429 and commits nothing."""
    if not push_enabled():
        return
    factory = async_sessionmaker(db.bind, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    task = asyncio.create_task(
        _broadcast_committed(
            factory,
            title="Anmeldung gesperrt",
            body=(
                f"{display_name}: zu viele falsche PINs von unbekannten Geräten. "
                f"Neue Geräte sind für dieses Konto {minutes} min gesperrt."
            ),
            tag=tag,
            target=None,
            audience=_new_alarm_recipients,
        )
    )
    _inflight.add(task)
    task.add_done_callback(_inflight.discard)


async def _broadcast_committed(
    factory: async_sessionmaker[AsyncSession],
    *,
    title: str,
    body: str,
    tag: str,
    target: str | None,
    audience: Callable[[AsyncSession], Awaitable[Collection[uuid.UUID]]] | None = None,
    dedup_key: str | None = None,
    ttl: int = DEFAULT_TTL_SECONDS,
    urgency: str | None = None,
) -> None:
    """Best-effort post-commit delivery with independent dead-endpoint pruning.

    ``audience`` (optional) reads the recipient accounts in the SENDING session, after the
    commit — so the list is the one that holds when the push leaves, not a stale copy."""
    try:
        async with factory() as send_db:
            # Refresh runtime-settable VAPID values before the blocking sender reads them.
            from .credentials import load

            await load(send_db)
            if audience is not None:
                await broadcast(
                    send_db,
                    title=title,
                    body=body,
                    tag=tag,
                    target=target,
                    user_ids=await audience(send_db),
                    ttl=ttl,
                    urgency=urgency,
                )
            elif dedup_key is not None:
                # the sweep's crossing key, where the caller has one (an Atemschutznotfall)
                await broadcast(send_db, title=title, body=body, tag=tag, target=target, dedup_key=dedup_key)
            else:
                await broadcast(send_db, title=title, body=body, tag=tag, target=target)
            await send_db.commit()
    except Exception:  # push must never affect already-committed intake
        logger.exception("Push after commit failed (%s)", tag)


async def object_visit_recipients(db: AsyncSession) -> list[uuid.UUID]:
    """The ACTIVE accounts an admin picked for «Neuer Objektbesuch» (``users.notify_object_visits``)."""
    from .models import User

    rows = await db.execute(select(User.id).where(User.notify_object_visits.is_(True), User.is_active.is_(True)))
    return list(rows.scalars())


def object_visit_message(object_name: str | None, people: list[str], findings: int) -> str:
    """«Gemeindeverwaltung · Frei Nina, Muster Max · 2 Mängel» — what, who, and whether to look now."""
    parts = [(object_name or "").strip() or "Objekt", ", ".join(p.strip() for p in people if p.strip())]
    if findings:
        parts.append("1 Mangel" if findings == 1 else f"{findings} Mängel")
    return " · ".join(p for p in parts if p)


async def notify_object_visit(
    db: AsyncSession, *, visit_id: str, object_name: str | None, people: list[str], findings: int
) -> int:
    """Queue a «Neuer Objektbesuch» push to the picked accounts after the visit's transaction commits.

    Fires once per visit — when it is first COMPLETED (the caller decides that), never for a draft
    save point or a correction. Returns 1 when queued, 0 when push is disabled. Nobody picked ⇒
    queued, but nothing is sent. A tap opens the visit (target ``besuch:<id>``, sw-notify.js).
    """
    if not push_enabled():
        return 0
    body = object_visit_message(object_name, people, findings)
    factory = async_sessionmaker(db.bind, class_=AsyncSession, expire_on_commit=False, autoflush=False)

    def schedule() -> None:
        task = asyncio.create_task(
            _broadcast_committed(
                factory,
                title="Neuer Objektbesuch",
                body=body,
                tag=f"ov-{visit_id}",
                target=f"besuch:{visit_id}",
                audience=object_visit_recipients,
            )
        )
        _inflight.add(task)
        task.add_done_callback(_inflight.discard)

    after_commit(db, schedule)
    return 1


# ---------------------------------------------------------------------------------------
# scheduler job
# ---------------------------------------------------------------------------------------

# in-memory crossing → last-notified ms (restart = one re-notification, safe direction)
_notified: dict[str, float] = {}

#: Per-crossing, the endpoints already reached in the CURRENT renotify round — populated by
#: `broadcast` (including sends that land after its deadline). It is what lets a partly-delivered
#: sweep retry only the recipients still outstanding, without re-notifying the ones already
#: reached. Reset at the start of each new renotify round (below) so a fresh round reaches
#: everyone again. In-memory like `_notified`: a restart re-notifies once, the safe direction.
_delivered: dict[str, set[str]] = {}


def _release(key: str) -> None:
    """Forget a crossing: the next ``_should_send`` for ``key`` sends at once, to everyone."""
    _notified.pop(key, None)
    _delivered.pop(key, None)


def _should_send(key: str, now_ms: float) -> bool:
    last = _notified.get(key)
    if last is not None:
        if now_ms - last < settings.push_renotify_seconds * 1000:
            return False
        # A new renotify round: everyone is notified again, so forget who was reached last round.
        # (An outstanding retry leaves `last` unset — `broadcast` popped it — and keeps the
        # per-recipient progress so only the missing browsers are re-sent.)
        _delivered.pop(key, None)
    _notified[key] = now_ms
    return True


async def check_and_push(db: AsyncSession, now_ms: float | None = None) -> int:
    """One due-ness sweep over all open incidents. Returns alerts sent."""
    # Demo workspaces are rebased to each visitor's arrival in the browser. The persisted seed
    # timestamps therefore look stale to this server-side sweep and must never notify demo
    # subscribers about an alarm that does not exist in their view.
    from .alarms import get_config_model, is_demo_deployment

    if await is_demo_deployment(db):
        return 0
    now_ms = now_ms if now_ms is not None else datetime.now(UTC).timestamp() * 1000
    # ⚠️ Through `get_config_model`, never `load_stored_config` bare. This sweep is the ONLY
    # reader whose failure is invisible: a raise here reaches `scheduler._push_sweep`, which
    # rolls back and logs — and the station then receives no «Trupp überfällig» and no
    # low-pressure push at all, with nothing on screen to say so. Falling back to the shipped
    # doctrine keeps alarming; refusing would silently stop it.
    doctrine = (await get_config_model(db)).doctrine.model_dump()

    sent = 0
    # who a due Wiedervorlage reaches — read once per sweep, and only when one is due
    reminder_audience: list[uuid.UUID] | None = None
    # Übungen are excluded outright: a drill's Atemschutz clocks and Wiedervorlagen are real
    # rows in a real workspace, so without this every local test run pushed «Trupp überfällig»
    # to every subscribed phone in the Wehr. The drill screen itself still shows its alarms —
    # this silences only the server-side broadcast.
    incidents = list(
        (
            await db.execute(select(Incident).where(Incident.is_archived.is_(False), Incident.is_exercise.is_(False)))
        ).scalars()
    )
    for inc in incidents:
        ws = inc.map_workspace_json
        ws = ws if isinstance(ws, dict) else {}
        # ⚠️ A CLOSED Einsatz (status off the active ones, not yet archived) alarms nothing: its
        # Tafel is frozen and nobody can enter the Kontakt or hold «Notfall beendet» that would end
        # it, so every 120 s a push about a crew from an Einsatz that is over (review of #300). The
        # client's alarm stops at the close for the same reason (useAbschluss · azMonitoring). The
        # Wiedervorlagen below are not Atemschutz and keep their own closure rule.
        for t in due_trupps(ws, doctrine, now_ms) if inc.is_open else []:
            # a Notfall's key is shared with the immediate push on its save (notify_notfall_changes)
            crossing = t.get("pressureAt") if t["reason"] == "pressure" else t["since"]
            key = f"az:{inc.id}:{t['id']}:{crossing}:{t['reason']}"
            if _should_send(key, now_ms):
                title, body = _atemschutz_message(t)
                sent += await broadcast(
                    db,
                    title=title,
                    body=body,
                    tag=f"atemschutz-{t['id']}",
                    # the tap opens the board ON this Trupp's card — the frontend router parses
                    # the ':<truppId>' suffix (sw-notify.js passes the target through opaquely);
                    # a Trupp without an id falls back to the bare surface target.
                    target=f"atemschutz:{t['id']}" if t.get("id") else "atemschutz",
                    dedup_key=key,
                )
        # journal rows (seq order) + any pre-migration blob rows still carrying reminders
        rows = [
            r.row_json
            for r in (
                await db.execute(
                    select(JournalEntry).where(JournalEntry.incident_id == inc.id).order_by(JournalEntry.seq.asc())
                )
            ).scalars()
        ]
        legacy = ws.get("timeline")
        legacy = list(reversed(legacy)) if isinstance(legacy, list) else []  # newest-first blob
        rows = [r for r in rows if isinstance(r, dict)]
        seen = {r.get("id") for r in rows if isinstance(r.get("id"), str)}
        rows.extend(r for r in legacy if isinstance(r, dict) and isinstance(r.get("id"), str) and r["id"] not in seen)
        closed_at = inc.closed_at.isoformat() if inc.closed_at else None
        for r in due_reminders(rows, now_ms, closed_at):
            key = f"rem:{inc.id}:{r['id']}:{r['dueAt']}"
            if _should_send(key, now_ms):
                if reminder_audience is None:
                    reminder_audience = await role_recipients(db, REMINDER_ROLES)
                sent += await broadcast(
                    db,
                    title="Wiedervorlage fällig",
                    body=r["text"],
                    tag=f"reminder-{r['id']}",
                    target="journal",
                    dedup_key=key,
                    user_ids=reminder_audience,
                )
    return sent
