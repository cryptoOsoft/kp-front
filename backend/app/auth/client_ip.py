"""Source identity for rate limiting — who the request actually came from.

A throttle is only as good as the key it counts against. `X-Forwarded-For` is a plain request
header: a client talking to the app directly can write whatever it likes into it, and a limiter
keyed on a value it finds there hands that client an unlimited supply of fresh buckets
(security audit SEC-08).

So trust is EXPLICIT, never inferred from the peer looking like infrastructure. The old rule
trusted any private/loopback peer's forwarded header, which means a direct client on the station
LAN could spoof arbitrary forwarded identities. Instead, `settings.trusted_forwarded_hops` names
how many reverse proxies sit in front of the app:

  · 0 (the safe default) — XFF is not consulted at all. The peer that actually opened the
    connection is the only thing the caller cannot forge, so it is the key. A deployment with no
    proxy needs no configuration to be safe; one behind a proxy that has not opted in loses
    per-client granularity (every request keys on the proxy) but is never spoofable.
  · N — each proxy *appends* the peer it saw, so the real client sits N entries from the right of
    the chain. Exactly the N rightmost entries are honoured as our own hops; anything a caller
    prepended sits to the left and is never reached. A chain shorter than promised is not the
    shape the deployment declared, so it falls back to the un-forgeable peer.

Railway/Caddy same-origin deployment: the reverse proxy is the one trusted hop → set
TRUSTED_FORWARDED_HOPS=1 (see config.py).
"""

import ipaddress

from fastapi import Request

from ..config import settings

#: Answer for a request with no peer at all (ASGI servers may omit `client`). One shared
#: bucket is the safe direction: unattributable traffic throttles together.
UNKNOWN_SOURCE = "unknown"


def _normalize(value: str) -> str | None:
    """A parseable IP as a canonical key, or None. An IPv4-mapped IPv6 literal is unwrapped
    so a proxy writing "::ffff:198.51.100.4" and one writing "198.51.100.4" name one bucket.

    An IPv6 address is keyed on its /64: that is what ONE subscriber is handed, and a device
    picks its own lower 64 bits — keyed on the full address, a single home line was an
    unlimited supply of fresh sources."""
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            return str(ip.ipv4_mapped)
        return str(ipaddress.ip_network((ip, 64), strict=False))
    return str(ip)


def client_ip(request: Request) -> str:
    """The rate-limiting key for this request's source (never trusted for authorization)."""
    peer = request.client.host if request.client else None
    if peer is None:
        return UNKNOWN_SOURCE

    hops = settings.trusted_forwarded_hops
    if hops <= 0:
        # No trusted proxy configured: ignore the forgeable header, key on the real peer.
        return _normalize(peer) or peer

    # `hops` trusted proxies → the client is the entry `hops` from the right (each proxy appended
    # the peer it saw). Fewer entries than promised, or an unparseable one → fall back to the peer.
    forwarded = [h.strip() for h in request.headers.get("x-forwarded-for", "").split(",") if h.strip()]
    if len(forwarded) >= hops:
        client = _normalize(forwarded[-hops])
        if client is not None:
            return client
    return _normalize(peer) or peer
