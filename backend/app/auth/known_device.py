"""The «known device» cookie — which accounts have signed in on this browser before.

Set at every successful login and refresh, signed with SECRET_KEY, httpOnly. It opens nothing:
a login still needs the PIN. It only decides which THROTTLE a wrong PIN counts against
(auth/pin_limiter): a device the account knows keeps the per-device cooldown ladder; every
other device shares the account's new-device budget, the one a guesser can exhaust.

Bound to the ACCOUNT, not just to the device: a cookie earned with one's own viewer login must
not buy the fast lane to an editor's tile.

Deliberately NOT bound to the account's auth generation (review of #562). A PIN reset, a role
change and a deactivation all bump it, and a stale cookie would put the Einsatzleiter's own
tablet behind the budget exactly when somebody is guessing at the account — resetting the PIN,
the natural answer to «Anmeldung gesperrt», would have locked the crew out with the correct
new PIN in hand. What a lost phone keeps is the ladder: about thirty guesses an hour at a PIN
it no longer knows, against ten for a stranger. Both are years for six digits.

Deliberately NOT cleared by «Abmelden», like the terminal enrollment (auth/cookies): signing
out of a shared tablet must not turn the station's own tablet into a stranger.
"""

import uuid
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Response
from jwt import InvalidTokenError as JWTError

from ..models import User
from .cookies import _set_session_cookie
from .security import _encode, decode_token

DEVICE_COOKIE = "known_device"
DEVICE_TOKEN_TYPE = "device"  # noqa: S105 — a JWT claim discriminator, not a credential

#: Browsers cap a cookie's life at 400 days; every login and refresh renews it.
DEVICE_TTL = timedelta(days=400)

#: A shared tablet collects accounts. Forty is past any crew's turn at one tablet and keeps
#: the cookie well under the 4 KB a browser stores; the longest unused account drops out.
MAX_ACCOUNTS = 40


@dataclass(frozen=True)
class KnownDevice:
    """A verified cookie: the device's own id (the cooldown key) and the ids of the accounts
    that signed in here, oldest first."""

    id: str
    accounts: tuple[str, ...] = ()

    def knows(self, account: str) -> bool:
        return account in self.accounts


def read_known_device(token: str | None) -> KnownDevice | None:
    """The cookie, verified — or None for an absent, expired, forged or malformed one."""
    if not token:
        return None
    try:
        payload = decode_token(token)
    except JWTError:
        return None
    device_id, accounts = payload.get("dev"), payload.get("acc")
    if payload.get("type") != DEVICE_TOKEN_TYPE or not isinstance(device_id, str) or not isinstance(accounts, list):
        return None
    return KnownDevice(device_id, tuple(a for a in accounts if isinstance(a, str)))


def remember_device(response: Response, device: KnownDevice | None, user: User) -> None:
    """Record that `user` signed in on this device, minting the device id on first use."""
    account = str(user.id)
    accounts = [a for a in (device.accounts if device else ()) if a != account] + [account]  # last = most recent
    token = _encode(
        {"dev": device.id if device else uuid.uuid4().hex, "acc": accounts[-MAX_ACCOUNTS:]},
        token_type=DEVICE_TOKEN_TYPE,
        expires=DEVICE_TTL,
    )
    _set_session_cookie(response, DEVICE_COOKIE, token, int(DEVICE_TTL.total_seconds()))
