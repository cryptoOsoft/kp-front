"""Availability-safe PIN cooldown (NOT a hard lockout).

PLAN §5: a few free attempts, then a growing cooldown (5s→10s→30s→…, capped). Never
permanent — we must never lock out the Einsatzleiter mid-incident.

Two properties the first version lacked (security audit SEC-08):

* **Admission is reserved, not checked.** `reserve` counts the attempt in the same synchronous
  step that decides whether to admit it. The route used to *check* the cooldown, then await a
  database round trip and a bcrypt verification, and only then record the failure — so 24
  simultaneous wrong PINs all passed a check that nobody had yet failed and all reached bcrypt.
  Nothing may be awaited between deciding and counting.
* **Buckets are bounded and they expire.** The key includes the request's source address and
  the *claimed* user id, both attacker-suppliable, so the map has to prune: a bucket untouched
  for `BUCKET_TTL_SECONDS` is forgotten (which is also how a legitimate operator's own slips
  decay), and the map never exceeds `MAX_BUCKETS`.

Deliberately still process-local. Multiple workers each keep their own view, so a distributed
attacker gets one ladder per worker; the account-recovery properties below matter more here
than exactness, and a shared store (Redis) is not something this deployment has. Documented
rather than pretended away.

Keying is per (account, source), not per account. A cooldown shared by every caller of one
account is a remote lockout switch: hostile traffic aimed at the Einsatzleiter's tile would
keep the Einsatzleiter out. Their own tablet has its own bucket and is never blocked by
somebody else's failures; a correct PIN clears that bucket immediately. The «source» of a
device the account knows is the device itself (auth/known_device), not its address — two
tablets behind the station's one address no longer share a ladder.

Per-source keying alone leaves source rotation open; `NewDeviceBudget` below closes it.
"""

import time

from ..config import settings

#: A bucket untouched for this long is forgotten — the pruning rule and the decay rule at once.
#: Comfortably longer than the deepest cooldown step, short enough that a mistyped-PIN ladder
#: does not follow an operator into the next hour.
BUCKET_TTL_SECONDS = 15 * 60

#: Hard ceiling on tracked buckets. Keys are attacker-suppliable, so the map must not grow
#: with the traffic; over the ceiling the least useful buckets (expired cooldowns first, then
#: least recently seen) are evicted.
MAX_BUCKETS = 10_000

#: Sweeping every write would be quadratic on a flood; sweeping only at the ceiling would let a
#: quiet deployment hold a day's worth of dead buckets. Both, then, at this cadence.
PRUNE_INTERVAL_SECONDS = 60


class PinLimiter:
    def __init__(self) -> None:
        # key -> (consecutive_failures, blocked_until_monotonic, last_seen_monotonic)
        self._state: dict[str, tuple[int, float, float]] = {}
        self._last_prune = 0.0

    @staticmethod
    def key(user_id: str, source: str) -> str:
        """The bucket a login attempt counts against: this account, from this source."""
        return f"{user_id}|{source}"

    def _bucket(self, key: str, now: float) -> tuple[int, float]:
        """(failures, blocked_until) for a key, treating an expired bucket as absent."""
        fails, until, seen = self._state.get(key, (0, 0.0, now))
        if now - seen > BUCKET_TTL_SECONDS:
            return 0, 0.0
        return fails, until

    def _wait(self, until: float, now: float) -> int:
        remaining = until - now
        return max(1, int(remaining + 0.999)) if remaining > 0 else 0

    def retry_after(self, key: str) -> int:
        """Seconds the caller must wait, or 0 if allowed to try now."""
        now = time.monotonic()
        _fails, until = self._bucket(key, now)
        return self._wait(until, now)

    def reserve(self, key: str) -> int:
        """Take one attempt slot: 0 = go ahead (and the attempt is already counted against
        the ladder), >0 = seconds to wait. Counting up front is what makes a concurrent burst
        cost the attacker its attempts; `record_success` gives the slot back to a caller who
        turned out to know the PIN."""
        now = time.monotonic()
        _fails, until = self._bucket(key, now)
        wait = self._wait(until, now)
        if wait:
            return wait
        self._register_failure(key, now)
        return 0

    def record_failure(self, key: str) -> int:
        """Register a wrong PIN; return the new cooldown in seconds (0 while in free tier)."""
        return self._register_failure(key, time.monotonic())

    def record_success(self, key: str) -> None:
        self._state.pop(key, None)

    def reset(self) -> None:
        self._state.clear()
        self._last_prune = 0.0

    def bucket_count(self) -> int:
        return len(self._state)

    # --- internals -------------------------------------------------------------------

    def _register_failure(self, key: str, now: float) -> int:
        fails, _until = self._bucket(key, now)
        fails += 1
        over = fails - settings.pin_free_attempts
        if over <= 0:
            self._state[key] = (fails, 0.0, now)
            cooldown = 0
        else:
            steps = settings.pin_cooldown_steps_seconds
            cooldown = steps[min(over - 1, len(steps) - 1)]
            self._state[key] = (fails, now + cooldown, now)
        if len(self._state) > MAX_BUCKETS or now - self._last_prune > PRUNE_INTERVAL_SECONDS:
            self._prune(now)
            self._last_prune = now
        return cooldown

    def _prune(self, now: float) -> None:
        for stale in [k for k, (_f, _u, seen) in self._state.items() if now - seen > BUCKET_TTL_SECONDS]:
            del self._state[stale]
        if len(self._state) <= MAX_BUCKETS:
            return
        # Still over the ceiling: evict by (cooldown already expired, longest unseen) so a
        # flood of invented keys sheds itself before a live cooldown does. Shed to a margin
        # below the ceiling, like the aggregate below: shedding to the ceiling itself meant a
        # flood paid one sort of 10,000 buckets per INSERT (the bounded-map test alone took 44 s).
        target = MAX_BUCKETS * 9 // 10
        ordered = sorted(self._state.items(), key=lambda item: (item[1][1], item[1][2]))
        for key, _bucket in ordered[: len(self._state) - target]:
            del self._state[key]


pin_limiter = PinLimiter()


# --- the new-device budget ------------------------------------------------------------------

#: Wrong PINs one ACCOUNT may collect from devices that never signed in to it, across every
#: source address, before new devices are refused for it. A person setting up a phone does not
#: mistype ten times; a guesser rotating addresses reaches it in a second.
NEW_DEVICE_FREE_FAILURES = 10

#: How long new devices are then refused, one step deeper per further lock while the guessing
#: goes on. At the last step that is ten guesses an hour: the 6-digit space takes over a decade.
NEW_DEVICE_LOCK_STEPS_SECONDS = (15 * 60, 30 * 60, 60 * 60)

#: An account nobody guessed at for this long starts over — count and step. A real person's
#: slips are forgotten by the next day; an attacker pacing below the budget gets nine a day.
NEW_DEVICE_QUIET_SECONDS = 24 * 60 * 60

#: Ceiling on tracked accounts. The key is the CLAIMED user id (attacker-suppliable), so the
#: map must stay bounded like the cooldown limiter's above.
MAX_BUDGET_ACCOUNTS = 10_000


class NewDeviceBudget:
    """Wrong PINs per ACCOUNT from devices it does not know — the answer to source rotation.

    The cooldown above is keyed per (account, source), so a caller rotating addresses mints a
    fresh bucket at will and guesses at the bcrypt ceiling: the whole 6-digit space in a day
    (sweep 2026-11-09, SEC.1). A cap shared by ALL callers of an account would stop that and be
    the remote lockout switch the cooldown's docstring warns about. So the cap is shared only by
    devices that never signed in to the account. A device that did carries a signed cookie
    saying so (auth/known_device) and never reaches this class: the Einsatzleiter's own tablet
    keeps the cooldown ladder and nothing else, whatever the rest of the internet does.

    What an attacker can still do: keep NEW devices out of one account by guessing at it. That
    is the price, and the owner's call (2026-11-09): a known device is never affected, the
    editors get a push when a lock first engages, and the admin's System page lists it.

    `reserve` counts the attempt in the step that admits it, like the cooldown — nothing may be
    awaited between deciding and counting. A caller who turns out to know the PIN gives the
    slot back (`release`). The lock engages on the attempt that ARRIVES at a full budget, so a
    tenth correct PIN is never the one that locks. Process-local, like the cooldown: a restart
    forgets it, which hands a guesser ten more tries per deploy.
    """

    def __init__(self) -> None:
        # account id -> (failures, locked_until_monotonic, locks_so_far, last_seen_monotonic)
        self._state: dict[str, tuple[int, float, int, float]] = {}

    def _entry(self, account: str, now: float) -> tuple[int, float, int]:
        fails, until, locks, seen = self._state.get(account, (0, 0.0, 0, now))
        if now - seen > NEW_DEVICE_QUIET_SECONDS and until <= now:
            return 0, 0.0, 0
        return fails, until, locks

    def reserve(self, account: str) -> tuple[int, int]:
        """Take one attempt slot for a new device. Returns ``(wait, engaged)``: ``wait`` 0 =
        go ahead (already counted), >0 = seconds until new devices may try again. ``engaged``
        is the lock's ordinal (1 = the first of this episode) on the ONE call that engages it,
        else 0 — the moment worth telling somebody about."""
        now = time.monotonic()
        fails, until, locks = self._entry(account, now)
        if until > now:
            return max(1, int(until - now + 0.999)), 0
        if fails >= NEW_DEVICE_FREE_FAILURES:
            step = NEW_DEVICE_LOCK_STEPS_SECONDS[min(locks, len(NEW_DEVICE_LOCK_STEPS_SECONDS) - 1)]
            self._state[account] = (0, now + step, locks + 1, now)
            return step, locks + 1
        self._state[account] = (fails + 1, 0.0, locks, now)
        if len(self._state) > MAX_BUDGET_ACCOUNTS:
            self._prune(now)
        return 0, 0

    def release(self, account: str) -> None:
        """Give a reserved slot back: the caller knew the PIN, or was refused before the verify."""
        fails, until, locks, seen = self._state.get(account, (0, 0.0, 0, 0.0))
        if fails > 0:
            self._state[account] = (fails - 1, until, locks, seen)

    def locked(self) -> dict[str, int]:
        """Accounts new devices are refused for right now → seconds left (the admin's view)."""
        now = time.monotonic()
        return {a: int(until - now + 0.999) for a, (_f, until, _l, _s) in self._state.items() if until > now}

    def reset(self) -> None:
        self._state.clear()

    def account_count(self) -> int:
        return len(self._state)

    def _prune(self, now: float) -> None:
        quiet = [
            a
            for a, (_f, until, _l, seen) in self._state.items()
            if until <= now and now - seen > NEW_DEVICE_QUIET_SECONDS
        ]
        for account in quiet:
            del self._state[account]
        if len(self._state) <= MAX_BUDGET_ACCOUNTS:
            return
        # Still over the ceiling: shed what matters least — never a live lock, then the fewest
        # locks and failures. Evicting a hot account would hand its guesser a fresh budget.
        # Shed to a margin below the ceiling so a flood of invented ids pays one sort per
        # ~thousand inserts, not per insert.
        target = MAX_BUDGET_ACCOUNTS * 9 // 10
        ordered = sorted(self._state.items(), key=lambda item: (item[1][1] > now, item[1][2], item[1][0]))
        for account, _entry in ordered[: len(self._state) - target]:
            del self._state[account]


new_device_budget = NewDeviceBudget()
