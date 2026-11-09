"""Unit tests for PIN hashing/verification and the availability-safe cooldown limiter.

Pure functions + in-memory limiter — no DB, no live server. Run with `uv run pytest`.
"""

from types import SimpleNamespace

import pytest

from app.auth import pin_limiter as pin_limiter_module
from app.auth.client_ip import _normalize
from app.auth.pin_limiter import (
    NEW_DEVICE_FREE_FAILURES,
    NEW_DEVICE_LOCK_STEPS_SECONDS,
    NEW_DEVICE_QUIET_SECONDS,
    NewDeviceBudget,
    PinLimiter,
)
from app.auth.security import hash_pin, verify_pin
from app.config import settings

# --- hash_pin / verify_pin --------------------------------------------------------


def test_hash_pin_roundtrip():
    pin = "1" * settings.pin_min_length
    h = hash_pin(pin)
    assert h != pin  # not stored in clear
    assert h.startswith("$2")  # bcrypt hash marker
    assert verify_pin(pin, h) is True


def test_verify_pin_rejects_wrong_pin():
    pin = "1" * settings.pin_min_length
    other = "2" * settings.pin_min_length
    h = hash_pin(pin)
    assert verify_pin(other, h) is False


def test_hash_pin_is_salted_unique():
    """Two hashes of the same PIN differ (random bcrypt salt) but both verify."""
    pin = "0" * settings.pin_min_length
    h1, h2 = hash_pin(pin), hash_pin(pin)
    assert h1 != h2
    assert verify_pin(pin, h1)
    assert verify_pin(pin, h2)


@pytest.mark.parametrize("bad", ["", "12345", "1234567890123", "12a456", "abcdef"])
def test_hash_pin_rejects_malformed(bad):
    """Too short, too long (13 > pin_max_length) or non-digit — all refused."""
    with pytest.raises(ValueError):
        hash_pin(bad)


def test_hash_pin_accepts_the_whole_range():
    """The policy is a 6–12 digit RANGE (06.09.), not exactly six — both ends round-trip."""
    for pin in ("1" * settings.pin_min_length, "2" * settings.pin_max_length):
        assert verify_pin(pin, hash_pin(pin)) is True


def test_verify_pin_tolerates_garbage_hash():
    """A corrupt/non-bcrypt stored hash must return False, never raise."""
    assert verify_pin("0" * settings.pin_min_length, "not-a-bcrypt-hash") is False


# --- PinLimiter cooldown ----------------------------------------------------------


def test_limiter_free_tier_then_growing_cooldown():
    lim = PinLimiter()
    uid = "user-1"

    # Free attempts incur no cooldown.
    for _ in range(settings.pin_free_attempts):
        assert lim.record_failure(uid) == 0
    assert lim.retry_after(uid) == 0

    # First over-limit failure starts the cooldown ladder.
    steps = settings.pin_cooldown_steps_seconds
    first = lim.record_failure(uid)
    assert first == steps[0]
    assert lim.retry_after(uid) > 0  # now blocked

    # Cooldown grows along the ladder and is capped at the last step.
    second = lim.record_failure(uid)
    assert second == steps[min(1, len(steps) - 1)]
    for _ in range(len(steps) + 3):
        capped = lim.record_failure(uid)
    assert capped == steps[-1]


def test_limiter_success_clears_state():
    lim = PinLimiter()
    uid = "user-2"
    for _ in range(settings.pin_free_attempts + 2):
        lim.record_failure(uid)
    assert lim.retry_after(uid) > 0
    lim.record_success(uid)
    assert lim.retry_after(uid) == 0
    # Back to free tier after a success.
    assert lim.record_failure(uid) == 0


def test_limiter_is_per_user():
    lim = PinLimiter()
    for _ in range(settings.pin_free_attempts + 1):
        lim.record_failure("a")
    assert lim.retry_after("a") > 0
    assert lim.retry_after("b") == 0  # unrelated user unaffected


# --- NewDeviceBudget ---------------------------------------------------------------


def _spend(budget: NewDeviceBudget, account: str = "u") -> None:
    for _ in range(NEW_DEVICE_FREE_FAILURES):
        assert budget.reserve(account) == (0, 0)


def test_budget_locks_on_the_attempt_that_arrives_at_a_full_one():
    budget = NewDeviceBudget()
    _spend(budget)
    first = NEW_DEVICE_LOCK_STEPS_SECONDS[0]
    assert budget.reserve("u") == (first, 1)  # engages — and says so exactly once
    wait, engaged = budget.reserve("u")
    assert 0 < wait <= first and engaged == 0
    assert budget.locked().keys() == {"u"}
    assert budget.reserve("someone-else") == (0, 0)  # per account


def test_budget_lock_deepens_while_the_guessing_goes_on(monkeypatch):
    budget = NewDeviceBudget()
    clock = [1000.0]
    # the module's `time` reference, never `time.monotonic` itself: asyncio reads that one too
    monkeypatch.setattr(pin_limiter_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    seen = []
    for _ in range(len(NEW_DEVICE_LOCK_STEPS_SECONDS) + 1):
        _spend(budget)
        wait, _engaged = budget.reserve("u")
        seen.append(wait)
        clock[0] += wait + 1  # the lock elapses; the guesser carries on at once
    assert seen == [*NEW_DEVICE_LOCK_STEPS_SECONDS, NEW_DEVICE_LOCK_STEPS_SECONDS[-1]]


def test_budget_forgets_an_account_left_alone_for_a_day(monkeypatch):
    budget = NewDeviceBudget()
    clock = [1000.0]
    # the module's `time` reference, never `time.monotonic` itself: asyncio reads that one too
    monkeypatch.setattr(pin_limiter_module, "time", SimpleNamespace(monotonic=lambda: clock[0]))
    _spend(budget)
    clock[0] += NEW_DEVICE_QUIET_SECONDS + 1
    assert budget.reserve("u") == (0, 0)  # a fresh budget, not a lock


def test_budget_gives_a_slot_back_to_whoever_knew_the_pin():
    budget = NewDeviceBudget()
    for _ in range(NEW_DEVICE_FREE_FAILURES * 3):
        assert budget.reserve("u") == (0, 0)
        budget.release("u")


def test_budget_never_evicts_and_refuses_a_new_id_at_the_ceiling(monkeypatch):
    """The map is the security bound: a flood of invented ids must not push out a real
    account's counter or its lock (it did — review of #562). A NEW id at the ceiling waits."""
    monkeypatch.setattr(pin_limiter_module, "MAX_BUDGET_ACCOUNTS", 50)
    budget = NewDeviceBudget()
    _spend(budget, "locked")
    budget.reserve("locked")
    for _ in range(NEW_DEVICE_FREE_FAILURES - 1):
        budget.reserve("counting")
    for i in range(200):
        budget.reserve(f"invented-{i}")

    assert budget.account_count() == 50
    assert budget.reserve("one-more")[0] > 0
    assert "locked" in budget.locked()
    assert budget.reserve("counting") == (0, 0)  # its tenth, still counted…
    assert budget.reserve("counting")[1] == 1  # …so the eleventh locks


def test_budget_forgets_an_id_that_is_no_account():
    budget = NewDeviceBudget()
    budget.reserve("invented")
    budget.forget("invented")
    assert budget.account_count() == 0


def test_cooldown_eviction_sheds_fresh_one_attempt_keys_before_a_spent_bucket(monkeypatch):
    """A flood is always NEWER than the bucket it wants gone; age alone evicted the real one."""
    monkeypatch.setattr(pin_limiter_module, "MAX_BUCKETS", 50)
    limiter = PinLimiter()
    for _ in range(settings.pin_free_attempts):
        limiter.reserve("real|1.1.1.1")
    for i in range(200):
        limiter.reserve(f"invented-{i}|1.1.1.1")
    limiter.reserve("real|1.1.1.1")  # the one that starts the ladder
    assert limiter.retry_after("real|1.1.1.1") > 0


def test_settings_refuse_an_inverted_pin_range():
    """min > max means NO pin can ever validate — that must be a loud boot failure, not a
    deployment where every SEED_PIN and admin PIN is rejected by an unsatisfiable range."""
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="PIN_MIN_LENGTH"):
        Settings(pin_min_length=10, pin_max_length=8)


def test_an_ipv6_source_is_its_subscribers_prefix():
    """One home line hands out a /64; keyed on the full address it was an endless supply."""
    assert _normalize("2001:db8:1:2:aaaa::1") == _normalize("2001:db8:1:2:bbbb::2") == "2001:db8:1:2::/64"
    assert _normalize("2001:db8:1:3::1") != _normalize("2001:db8:1:2::1")
    assert _normalize("::ffff:198.51.100.4") == "198.51.100.4"
