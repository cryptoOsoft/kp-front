"""The service worker's imports are never served from the HTTP cache.

A worker script with an hour of `max-age` lets a NEW `sw.js` install with an OLD import —
`sw-boot-timing.js` and `sw-tile-store.js` were both added to the worker and forgotten here.
"""

import re
from pathlib import Path

import pytest

from app.spa import _NO_CACHE_FILES

VITE_CONFIG = Path(__file__).resolve().parents[2] / "vite.config.ts"


def test_every_script_the_worker_imports_is_no_cache():
    if not VITE_CONFIG.exists():
        pytest.skip("frontend sources are not part of this checkout")
    listed = re.search(r"importScripts:\s*\[([^\]]*)\]", VITE_CONFIG.read_text(encoding="utf-8"))
    assert listed, "vite.config.ts no longer names workbox.importScripts"
    imports = set(re.findall(r"'([^']+)'", listed.group(1)))
    assert imports, "the import list parsed empty"
    assert imports <= _NO_CACHE_FILES
