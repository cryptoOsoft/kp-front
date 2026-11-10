"""Sanitised crash traces that stay on the station's own server.

* ``scrub.py``  — the allow-list; the only place a field can be added to a crash entry
* ``recent.py`` — the local, in-memory crash buffer the operator's Diagnose-Datei hands over

Nothing here transmits. ``api/diag.py`` scrubs each client error and buffers it; a bug report
reaches the maintainer when an operator exports that buffer (``GET /api/diag/export``) and
attaches it to a mail or a GitHub issue. A human is the transport, on purpose.

The package used to hold an opt-in forwarder to an outside ingest as well (consent, install
id, outbox, Sentry envelope, DSN). It was deleted on 09.11.2026: the maintainer's ingest was
retired in 09/2026, and the forwarder had no destination and no switch in the UI. The package
keeps its name; both modules are byte-identical with kp-rueck (``shared/MANIFEST.json``).
"""
