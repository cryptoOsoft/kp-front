"""The «known device» cookie — which accounts have signed in on this browser before.

Set at every successful login and refresh, signed with SECRET_KEY, httpOnly. It opens nothing:
a login still needs the PIN. It only decides which THROTTLE a wrong PIN counts against
(auth/pin_limiter): a device the account knows keeps the per-device cooldown ladder; every
other device shares the account's new-device budget, the one a guesser can exhaust.

Bound to the ACCOUNT, not just to the device: a cookie earned with one's own viewer login must
not buy the fast lane to an editor's tile. And bound to the account's auth generation: a PIN
reset or a deactivation makes every device unknown again, the thrown-out phone included.

Deliberately NOT cleared by «Abmelden», like the terminal enrollment (auth/cookies): signing
out of a shared tablet must not turn the station's own tablet into a stranger.
"""

import uuid
from dataclasses import dataclass, field
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
    """A verified cookie: the device's own id (the cooldown key) and, per account id that
    signed in here, the auth generation it signed in under."""

    id: str
    accounts: dict[str, int] = field(default_factory=dict)

    def knows(self, account: str) -> bool:
        """Whether this device CLAIMS the account — before the generation is checked against
        the stored user, which only the route can do (`is_current`)."""
        return account in self.accounts

    def is_current(self, user: User) -> bool:
        return self.accounts.get(str(user.id)) == user.auth_generation


def read_known_device(token: str | None) -> KnownDevice | None:
    """The cookie, verified — or None for an absent, expired, forged or malformed one."""
    if not token:
        return None
    try:
        payload = decode_token(token)
    except JWTError:
        return None
    device_id, accounts = payload.get("dev"), payload.get("acc")
    if payload.get("type") != DEVICE_TOKEN_TYPE or not isinstance(device_id, str) or not isinstance(accounts, dict):
        return None
    return KnownDevice(device_id, {k: v for k, v in accounts.items() if isinstance(k, str) and isinstance(v, int)})


def remember_device(response: Response, device: KnownDevice | None, user: User) -> None:
    """Record that `user` signed in on this device, minting the device id on first use."""
    accounts = {k: v for k, v in (device.accounts if device else {}).items() if k != str(user.id)}
    accounts[str(user.id)] = user.auth_generation  # last = most recently used
    kept = dict(list(accounts.items())[-MAX_ACCOUNTS:])
    token = _encode(
        {"dev": device.id if device else uuid.uuid4().hex, "acc": kept},
        token_type=DEVICE_TOKEN_TYPE,
        expires=DEVICE_TTL,
    )
    _set_session_cookie(response, DEVICE_COOKIE, token, int(DEVICE_TTL.total_seconds()))
