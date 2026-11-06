"""Ids for records the SERVER mints into a workspace or the Verlauf, in the client's shape.

`new_id(prefix)` is `src/lib/ids.ts · newId` on the server: `<prefix><ms>-<seq><rand>`, so a row
or object the server seeds (tutorial_seed) cannot be told apart from one a device minted, and
merges by id the same way (docs/sync-and-offline.md · «IDs are prefixed timestamps»). Derived,
deterministic ids (`vps-…`, `sys…`) stay with their writers — this is for fresh records only.
"""

import itertools
import secrets
import string
import time

_ALPHABET = string.digits + string.ascii_lowercase
#: wraps at 36², like the client's counter
_seq = itertools.count(1)


def _base36(n: int, width: int) -> str:
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = _ALPHABET[r] + out
    return out.rjust(width, "0")


def new_id(prefix: str) -> str:
    """A fresh record id: `<prefix><ms>-<seq:2><rand:3>`, e.g. `d1758038400123-0kf9a`."""
    seq = next(_seq) % 1296
    rand = "".join(secrets.choice(_ALPHABET) for _ in range(3))
    return f"{prefix}{time.time_ns() // 1_000_000}-{_base36(seq, 2)}{rand}"
