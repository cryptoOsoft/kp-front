"""Async DB test harness for the integration tests.

Runs against ``DATABASE_URL`` when set (CI provides a postgres:16 service), otherwise an
ephemeral in-memory SQLite (``sqlite+aiosqlite``). The postgres-specific column types
(JSONB, the postgres UUID) are taught to render on SQLite via lightweight ``@compiles``
shims so the *whole* schema — incidents, audit chain, revoked_tokens — stands up locally
without a database server. Every timestamp column in the schema declares
``DateTime(timezone=True)``; SQLite's own DATETIME impl silently drops the tzinfo on write
and hands back a naive datetime on read, which is not what asyncpg does, so that impl is
swapped for one that reattaches UTC on the way out. SQLite also ignores every foreign key
unless ``PRAGMA foreign_keys=ON`` is set per connection, so it is — an ``ON DELETE CASCADE`` /
``RESTRICT`` behaves here the way Postgres enforces it. Behaviour the tests assert
(optimistic-lock UPDATE, blocklist PK lookup, hash chain, FK cascades) is then
dialect-agnostic, so SQLite is a faithful stand-in here.

⚠️ One thing it is NOT: every session shares ONE connection (``StaticPool`` — an in-memory
database lives and dies with its connection), so sessions are not isolated transactions the
way they are on Postgres. A session that rolls back undoes whatever another session has
written but not yet committed. Only concurrency exposes that (a background task writing while
a request runs); such a test lets the task finish first (see ``test_stt._poll_done``).

On Postgres the schema is built ONCE per process and every test ends by emptying it (rows
deleted, serial counters restarted) — not by dropping and re-creating 41 tables, which was most
of the suite's 15 CI minutes. A test still starts on empty tables, exactly as before; one that
drops a table on purpose (``test_integration_credentials``) makes the next test rebuild it.

Under pytest-xdist (``-n 4``) each worker gets its OWN database, ``<name>_gw0`` … next to the
one ``DATABASE_URL`` names, created at session start and dropped at the end. Workers sharing
one database would be the end of a reliable suite. ``DATABASE_URL`` itself is pointed at the
worker's database before any app module reads it, so code on the app's own engine lands there
too. A plain ``uv run pytest`` (no ``-n``) uses ``DATABASE_URL`` as it is.

Fixtures:
- ``engine`` / ``db_session``: a rolled-back async session per test.
- ``client``: an httpx AsyncClient wired to the FastAPI app with ``get_db`` overridden
  and the token blocklist pointed at the test session factory.
- ``editor`` / ``viewer``: seeded users with a known PIN.
"""

import os

import pytest
import pytest_asyncio
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Ensure config accepts a secret in local runs before app modules import settings.
os.environ.setdefault(
    "SECRET_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",  # gitleaks:allow
)
# Configure the deployment-admin secret so the admin surface is ENABLED under test (fail-closed
# otherwise). Tests unlock it via the ``admin_login`` fixture; ``test_admin_auth`` overrides it
# to exercise the unset / fail-closed path.
TEST_ADMIN_SECRET = "test-admin-secret-0123456789ab"
os.environ.setdefault("ADMIN_SECRET", TEST_ADMIN_SECRET)
# The suite never talks to MeteoSwiss: the weather layer's jobs (app/scheduler ·
# _start_process_jobs) would fetch at once whenever a test starts the scheduler. Its own tests
# switch it on per test and feed the service directly (tests/test_weather_layer.py).
os.environ.setdefault("WEATHER_LAYER_ENABLED", "false")

TEST_PIN = "135790"[:6]


def _postgres_url(url: str) -> str:
    return url.replace("postgresql://", "postgresql+asyncpg://", 1) if url.startswith("postgresql://") else url


# The database DATABASE_URL names when the run starts. Under xdist it is only the ADMIN
# connection (CREATE/DROP DATABASE cannot run inside the database it creates); the tests use
# the worker's own, derived from it. Kept in the environment because this module is imported
# twice (pytest's `conftest`, and `from conftest import …` in a few tests) — the second import
# must not take the already-redirected DATABASE_URL for the base.
_BASE_DATABASE_URL = _postgres_url(
    os.environ.setdefault("KPF_TEST_BASE_DATABASE_URL", os.environ.get("DATABASE_URL", ""))
)
_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")  # gw0, gw1, … — None when serial


def _worker_database_url() -> str | None:
    if not (_XDIST_WORKER and _BASE_DATABASE_URL.startswith("postgresql")):
        return None
    from sqlalchemy.engine import make_url

    url = make_url(_BASE_DATABASE_URL)
    return url.set(database=f"{url.database}_{_XDIST_WORKER}").render_as_string(hide_password=False)


_WORKER_DATABASE_URL = _worker_database_url()
if _WORKER_DATABASE_URL:
    # Before any app module imports settings — app.database's own engine follows it.
    os.environ["DATABASE_URL"] = _WORKER_DATABASE_URL


async def _admin(*statements: str) -> None:
    from sqlalchemy import text

    eng = create_async_engine(_BASE_DATABASE_URL, isolation_level="AUTOCOMMIT")
    try:
        async with eng.connect() as conn:
            for statement in statements:
                await conn.execute(text(statement))
    finally:
        await eng.dispose()


def pytest_sessionstart(session) -> None:
    if _WORKER_DATABASE_URL:
        import asyncio

        from sqlalchemy.engine import make_url

        name = make_url(_WORKER_DATABASE_URL).database
        # DROP first: a run that was killed leaves its database behind, and that is harmless.
        asyncio.run(_admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', f'CREATE DATABASE "{name}"'))


def pytest_sessionfinish(session, exitstatus) -> None:
    import asyncio
    import contextlib

    from sqlalchemy.engine import make_url

    # Best effort — a leftover database or table is cleared by the next run, and a failure
    # here must never hide the actual result.
    with contextlib.suppress(Exception):
        if _WORKER_DATABASE_URL:
            name = make_url(_WORKER_DATABASE_URL).database
            asyncio.run(_admin(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        elif _SCHEMA_READY and _BASE_DATABASE_URL.startswith("postgresql"):
            asyncio.run(_drop_schema(_BASE_DATABASE_URL))


# Postgres only: the metadata schema has been built in this process and is known to be intact.
_SCHEMA_READY = False


async def _drop_schema(url: str) -> None:
    from app.database import Base

    eng = create_async_engine(url)
    try:
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
    finally:
        await eng.dispose()


async def _empty_tables(eng) -> None:
    """Every row gone and every serial counter back at 1 — what a freshly created table is.

    DELETE, not TRUNCATE: on empty-ish tables it is ~40 ms where TRUNCATE (a new file per table)
    took 1–2.5 s on a Postgres that fsyncs. Children first (reverse dependency order), so no
    foreign key is ever in the way.
    """
    from sqlalchemy import text

    from app.database import Base

    async with eng.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())
        for table in Base.metadata.sorted_tables:
            col = table.autoincrement_column
            if col is not None:
                await conn.execute(
                    text("SELECT setval(pg_get_serial_sequence(:t, :c), 1, false)"),
                    {"t": table.name, "c": col.name},
                )


def _install_sqlite_shims() -> None:
    """Teach SQLite to render the postgres-only column types used across the schema, and to
    round-trip a tz-aware ``DateTime`` the way a real Postgres/asyncpg pair does."""
    from datetime import UTC

    from sqlalchemy import DateTime
    from sqlalchemy.dialects import sqlite as sqlite_dialect
    from sqlalchemy.dialects.postgresql import JSONB, UUID
    from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite
    from sqlalchemy.ext.compiler import compiles

    @compiles(JSONB, "sqlite")
    def _compile_jsonb(type_, compiler, **kw):
        return "JSON"

    @compiles(UUID, "sqlite")
    def _compile_uuid(type_, compiler, **kw):
        return "CHAR(36)"

    class _TZAwareSQLiteDateTime(sqlite_dialect.DATETIME):
        """Same on-disk string as SQLite's own DATETIME impl; only the read side differs,
        reattaching UTC so a ``timezone=True`` column answers with an aware datetime here
        too — every timestamp in this schema declares one, so nothing here is ever meant
        to stay naive."""

        def result_processor(self, dialect, coltype):
            process = super().result_processor(dialect, coltype)

            def process_and_localize(value):
                value = process(value)
                return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value

            return process_and_localize

    # `aiosqlite`'s dialect has no colspecs of its own — it inherits pysqlite's, which is
    # where `DateTime` actually resolves to SQLite's DATETIME impl. Mutated in place (not
    # reassigned) so that inheritance keeps seeing it.
    SQLiteDialect_pysqlite.colspecs[DateTime] = _TZAwareSQLiteDateTime


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        return "sqlite+aiosqlite:///:memory:"
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


@pytest_asyncio.fixture
async def engine(database_url: str):
    is_sqlite = database_url.startswith("sqlite")
    if is_sqlite:
        _install_sqlite_shims()

    # A single shared in-memory connection so the schema persists across sessions
    # within one test (StaticPool keeps the same connection).
    kwargs: dict = {}
    if is_sqlite:
        from sqlalchemy.pool import StaticPool

        kwargs = {"poolclass": StaticPool, "connect_args": {"check_same_thread": False}}

    eng = create_async_engine(database_url, **kwargs)
    if is_sqlite:
        from sqlalchemy import event

        # Postgres always enforces foreign keys; SQLite only when asked, per connection. Without
        # this the demo reset's object → plan-dataset cascade silently did nothing here, and the
        # 20.09.2026 regression it guards (a RESTRICT that aborted the whole reset) was invisible.
        @event.listens_for(eng.sync_engine, "connect")
        def _enforce_foreign_keys(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

    import app.models  # noqa: F401  (register tables on Base.metadata)
    from app.database import Base

    if is_sqlite:
        # A new in-memory database per engine — building it is cheap, and it dies with the engine.
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            yield eng
        finally:
            await eng.dispose()
        return

    global _SCHEMA_READY
    if not _SCHEMA_READY:
        # drop first: CI migrates this database with alembic before the run, and the tests have
        # always run on the metadata's schema, not on the migrated one.
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        _SCHEMA_READY = True
    try:
        yield eng
    finally:
        try:
            await _empty_tables(eng)
        except DBAPIError:
            # The test dropped or broke a table on purpose — the next one rebuilds the schema.
            _SCHEMA_READY = False
        await eng.dispose()


@pytest.fixture(autouse=True)
def _clean_overpass_caches():
    """Overpass answers and the parsed station snapshot are cached process-wide (app/overpass ·
    _cache/_inflight, app/reference_buildings · _cache): one test's answer must not be the next
    one's cache hit."""
    from app import overpass, reference_buildings

    def reset() -> None:
        overpass._cache.clear()
        overpass._inflight.clear()
        reference_buildings._cache = None
        reference_buildings._live = None
        reference_buildings._live_load = None

    reset()
    yield
    reset()


@pytest.fixture(autouse=True)
def _clean_credential_cache():
    """The integration-credential store caches its DB rows process-wide (app/credentials).

    Each test gets its own database, so a value one test stored would otherwise still be in
    the snapshot for the next one. The environment half is not cached at all, so a
    ``monkeypatch.setattr(settings, …)`` is live immediately either way.
    """
    from app.credentials import reset_cache

    reset_cache()
    yield
    reset_cache()


@pytest_asyncio.fixture
async def session_factory(engine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)


@pytest_asyncio.fixture
async def db_session(session_factory) -> AsyncSession:
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(engine, session_factory):
    """FastAPI app with get_db overridden onto the test DB and a real cookie jar."""
    import httpx

    from app.auth.capture_limiter import capture_limiter, position_limiter
    from app.auth.pin_limiter import new_device_budget, pin_limiter
    from app.auth.token_blocklist import token_blocklist
    from app.database import get_db
    from app.main import app

    # In-memory per-IP bucket persists across tests (module singleton) — start each test full
    # so a burst-draining rate-limit test can't starve unrelated capture tests. The position
    # bucket is a SECOND singleton with its own sizing; leaving it undrained made a whole file
    # of position tests order-dependent (adding one POST early failed a test much further down).
    # The PIN/login limiter is a THIRD such singleton: once a guess during cooldown is refused
    # rather than verified (SEC-08), a bucket left hot by a login/limiter test 429s an unrelated
    # test that later logs in with the same (account, source) key — reset it too.
    capture_limiter.reset()
    position_limiter.reset()
    pin_limiter.reset()
    # The account's new-device budget is a FOURTH singleton: a test that spends it would
    # otherwise refuse every later first login of the same seeded user.
    new_device_budget.reset()
    # …and a FIFTH: the crash sink's per-source bucket (api/diag, 24.09.2026). Every test client
    # is one source, so a file of client-error tests would otherwise 429 the next one.
    from app.api.diag import client_error_limiter

    client_error_limiter.reset()

    async def _override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = _override_get_db
    # Point the persisted blocklist at the test DB (auth hot path).
    prev_factory = token_blocklist._session_factory
    token_blocklist._session_factory = session_factory

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    token_blocklist._session_factory = prev_factory


async def _make_user(session: AsyncSession, *, username: str, role: str):
    from app.auth.security import hash_pin
    from app.models import User

    user = User(
        username=username,
        pin_hash=hash_pin(TEST_PIN),
        role=role,
        display_name=username.title(),
        is_active=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest_asyncio.fixture
async def editor(db_session: AsyncSession):
    return await _make_user(db_session, username="cmd", role="editor")


@pytest_asyncio.fixture
async def viewer(db_session: AsyncSession):
    return await _make_user(db_session, username="view", role="viewer")


@pytest.fixture
def put_config():
    """PUT a config document with the ``If-Match`` the endpoint now requires of EVERY caller.

    Reads the current version and sends it back, which is what a correct client does — and what
    the tests whose subject is something ELSE (branding, the alarm vocabulary, the demo guard)
    need in one line. Tests about the guard itself call ``client.put`` directly, because the
    missing or stale header IS their subject. ``force=True`` adds ``?force=true``, the override
    for a write that deliberately empties a populated section.
    """

    async def _put(client, document: dict, *, force: bool = False, headers: dict | None = None):
        version = (await client.get("/api/config")).json()["version"]
        return await client.put(
            "/api/config",
            json=document,
            headers={"If-Match": version, **(headers or {})},
            params={"force": "true"} if force else None,
        )

    return _put


@pytest.fixture
def admin_login():
    """Unlock the deployment-admin surface on a client (sets the admin-session cookie).
    Independent of the kiosk login — admin authority is the shared ADMIN_SECRET."""

    async def _unlock(client) -> None:
        r = await client.post("/api/admin/login", json={"secret": TEST_ADMIN_SECRET})
        assert r.status_code == 200, r.text

    return _unlock
