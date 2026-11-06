"""`board-template/1` (10.10.2026): the contract a station writes its Tafel pages against, and the
pipeline that carries them — the same one the checklists ride (manifest → `admin_board_templates`
→ `tafel:<id>` reference datasets → the Tafel, offline-cached).

- the bundled FKS file is valid against the model, and strict 1:1 with the poster;
- the model refuses what the app would silently ignore (`extra="forbid"`), and says where;
- docs/board-template.schema.json is exactly what the model generates (drift test);
- the manifest owns its datasets: a push uploads, validates server-side, and prunes the rest.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import select

import app.storage as storage_mod
from app import admin_board_templates
from app.admin_board_templates import TemplateEntry, _amain, _load, _read_manifest, expected_ids, prune_candidates
from app.board_templates import BoardTemplate, board_template_problem, parse_board_template, template_json_schema
from app.models import ReferenceDataset

REPO = Path(__file__).resolve().parents[2]
BUNDLED = REPO / "src" / "data" / "boardTemplates" / "fks-erste-fuehrung.json"
COMMITTED_SCHEMA = REPO / "docs" / "board-template.schema.json"
repo_only = pytest.mark.skipif(not BUNDLED.exists(), reason="needs the repo checkout (the bundled template)")


def _fks() -> dict:
    return json.loads(BUNDLED.read_text(encoding="utf-8"))


@repo_only
def test_the_bundled_fks_set_is_a_valid_board_template():
    t = parse_board_template(BUNDLED.read_bytes())
    assert t.id == "fks-erste-fuehrung"
    assert [p.id for p in t.pages] == [
        "ef",
        "problem-tendenz",
        "mittel",
        "verbindungen",
        "konzept",
        "rapport",
        "pendenzen",
    ]


@repo_only
def test_the_erste_fuehrung_is_the_poster_one_to_one():
    ef = BoardTemplate.model_validate(_fks()).pages[0]
    assert [s.id for s in ef.sections] == ["problem", "lagekarte", "massnahmen", "mittel", "verbindungen", "absprachen"]
    assert ef.header is False  # the staging header line is a switch, off
    absprache = ef.sections[5]
    shown = [r.id for r in absprache.fixedRows if not r.hidden]
    assert shown == [
        "patientensammelstelle",
        "sanitaetshilfsstelle",
        "rettungsachse",
        "standort-einsatzleitung",
        "sammelstelle-unverletzte",
        "warteraum",
    ]


@repo_only
def test_the_committed_schema_is_what_the_model_generates():
    """Regenerate with `just board-template-schema` in the change that touches the model."""
    assert json.loads(COMMITTED_SCHEMA.read_text(encoding="utf-8")) == template_json_schema()


@repo_only
@pytest.mark.parametrize(
    ("patch", "where"),
    [
        (lambda t: t["pages"][0]["sections"][0].update(colour="red"), "colour"),  # a typo is refused, never ignored
        (lambda t: t.update(schema="board-template/2"), "schema"),
        (lambda t: t["pages"][0]["sections"].append(dict(t["pages"][0]["sections"][1])), "zweimal"),
        (lambda t: t["pages"][0]["sections"][5]["fixedRows"][0]["cells"].update(ort="x"), "feste Spalten"),
        (lambda t: t["pages"][0].update(title={"fr": "Première"}), "de"),
        (lambda t: t["pages"][0].update(id="Erste Führung"), "pattern"),
        (lambda t: t["pages"][0]["sections"][1].update(type="sketch"), "sketch"),
        # a live section shows its source's own columns and nothing else, and only a known source
        (
            lambda t: t["pages"][-1]["sections"][0]["columns"].append({"id": "ort", "label": "Ort"}),
            "unbekannte Spalte ort",
        ),
        (lambda t: t["pages"][-1]["sections"][0].update(source="problems"), "source"),
        (lambda t: t["pages"][-1]["sections"][0]["columns"][0].update(type="time"), "type"),
    ],
)
def test_a_broken_template_names_what_is_wrong(patch, where):
    t = _fks()
    patch(t)
    problem = board_template_problem(t)
    assert problem is not None
    assert where in problem


def test_a_label_is_a_string_or_one_per_language():
    t = {
        "schema": "board-template/1",
        "id": "x",
        "version": 1,
        "title": "X",
        "pages": [
            {
                "id": "p",
                "title": {"de": "Seite", "fr": "Page"},
                "sections": [{"id": "t", "type": "text", "fields": [{"id": "f", "label": "Feld"}]}],
            }
        ],
    }
    assert board_template_problem(t) is None
    t["pages"][0]["title"] = {"de": "Seite", "rm": "Pagina"}
    assert "rm" in board_template_problem(t)


# --- the manifest ----------------------------------------------------------------------


def test_the_manifest_owns_its_datasets(tmp_path):
    m = tmp_path / "tafel.manifest.json"
    m.write_text(
        json.dumps(
            {
                "templates": [
                    {"id": "fks-erste-fuehrung", "file": "tafel/fks.json"},
                    {"id": "zivilschutz", "file": "tafel/zs.json"},
                ]
            }
        )
    )
    entries = _read_manifest(m)
    assert expected_ids(entries) == {"tafel:fks-erste-fuehrung", "tafel:zivilschutz"}


def test_a_manifest_entry_refuses_unknown_keys(tmp_path):
    with pytest.raises(ValidationError):
        TemplateEntry(id="x", file="x.json", kind="poster")
    m = tmp_path / "tafel.manifest.json"
    m.write_text(json.dumps([{"id": "x", "file": "x.json"}, {"id": "x", "file": "y.json"}]))
    with pytest.raises(SystemExit):
        _read_manifest(m)


# --- the reference API ------------------------------------------------------------------


@pytest.fixture
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_mod, "_ROOT", str(tmp_path))
    return tmp_path


async def _put(client, dataset_id: str, data: bytes):
    return await client.put(
        f"/api/reference/{dataset_id}", files={"file": ("t.json", data, "application/json")}, data={"title": "FKS"}
    )


@repo_only
async def test_an_upload_is_validated_and_stored_as_a_tafel_template(client, admin_login, db_session, isolated_storage):
    await admin_login(client)
    ok = await _put(client, "tafel:fks-erste-fuehrung", BUNDLED.read_bytes())
    assert ok.status_code == 200, ok.text
    assert ok.json()["kind"] == "tafel"
    bad = _fks()
    bad["pages"][0]["sections"][0]["colour"] = "red"
    refused = await _put(client, "tafel:kaputt", json.dumps(bad).encode())
    assert refused.status_code == 422
    assert "colour" in refused.json()["detail"]
    ids = [d.id for d in (await db_session.execute(select(ReferenceDataset))).scalars()]
    assert ids == ["tafel:fks-erste-fuehrung"]  # the broken one left nothing behind


@repo_only
async def test_prune_drops_unlisted_board_templates_only(client, admin_login, isolated_storage):
    await admin_login(client)
    assert (await _put(client, "tafel:fks-erste-fuehrung", BUNDLED.read_bytes())).status_code == 200
    alt = _fks()
    alt["id"] = "alt"  # an upload carries its own id (review of #338)
    assert (await _put(client, "tafel:alt", json.dumps(alt).encode())).status_code == 200
    geo = await client.put(
        "/api/reference/geo:hydrant",
        files={"file": ("h.geojson", b'{"type":"FeatureCollection","features":[]}', "application/geo+json")},
    )
    assert geo.status_code == 200
    r = await client.post("/api/reference/tafel/prune", json=["tafel:fks-erste-fuehrung"])
    assert r.json() == {"pruned": ["tafel:alt"]}
    listed = sorted(d["id"] for d in (await client.get("/api/reference")).json())
    assert listed == ["geo:hydrant", "tafel:fks-erste-fuehrung"]


async def test_prune_is_admin_only(client):
    r = await client.post("/api/reference/tafel/prune", json=[])
    assert r.status_code == 401


# --- prune safety (review of #338) -------------------------------------------------------


def test_prune_candidates_are_everything_the_manifest_does_not_list_and_never_implicit():
    entries = [TemplateEntry(id="fks-erste-fuehrung", file="x.json")]
    stored = ["tafel:fks-erste-fuehrung", "tafel:admin-upload", "checklists:fu"]
    assert prune_candidates(stored, entries) == ["tafel:admin-upload"]


async def test_an_empty_manifest_is_refused(tmp_path):
    m = tmp_path / "tafel.manifest.json"
    m.write_text(json.dumps({"templates": []}))
    with pytest.raises(SystemExit):
        await _amain(["push", str(m), "--base", "http://x", "--admin-secret", "s", "--prune"])


@repo_only
async def test_an_upload_must_carry_its_own_id_under_a_valid_slot(client, admin_login, isolated_storage):
    await admin_login(client)
    wrong_slot = await _put(client, "tafel:andere", BUNDLED.read_bytes())
    assert wrong_slot.status_code == 422
    assert "fks-erste-fuehrung" in wrong_slot.json()["detail"]
    bad_id = await _put(client, "tafel:FKS_1", BUNDLED.read_bytes())
    assert bad_id.status_code == 422


@repo_only
async def test_prune_touches_only_valid_board_template_ids(client, admin_login, db_session, isolated_storage):
    await admin_login(client)
    assert (await _put(client, "tafel:fks-erste-fuehrung", BUNDLED.read_bytes())).status_code == 200
    db_session.add(ReferenceDataset(id="tafel:legacy:x", kind="geojson", title="x"))
    await db_session.commit()
    r = await client.post("/api/reference/tafel/prune", json=[])
    assert r.json() == {"pruned": ["tafel:fks-erste-fuehrung"]}
    ids = sorted(d.id for d in (await db_session.execute(select(ReferenceDataset))).scalars())
    assert ids == ["tafel:legacy:x"]


@repo_only
async def test_load_prunes_only_when_asked(monkeypatch, session_factory, db_session, isolated_storage):
    monkeypatch.setattr(admin_board_templates, "async_session_maker", session_factory)
    db_session.add(ReferenceDataset(id="tafel:admin-upload", kind="tafel", title="Upload"))
    await db_session.commit()
    raw = BUNDLED.read_bytes()
    tpl = BoardTemplate.model_validate_json(raw)
    templates = [(TemplateEntry(id=tpl.id, file="x.json"), tpl, raw)]

    async def ids() -> list[str]:
        async with session_factory() as s:
            return sorted((await s.execute(select(ReferenceDataset.id))).scalars())

    # a dry run lists the candidate and writes nothing
    assert await _load(templates, prune=True, dry_run=True) == (0, ["tafel:admin-upload"])
    assert await ids() == ["tafel:admin-upload"]
    # without --prune the upload stays
    assert await _load(templates, prune=False) == (1, ["tafel:admin-upload"])
    assert await ids() == ["tafel:admin-upload", "tafel:fks-erste-fuehrung"]
    # with --prune it goes
    await _load(templates, prune=True)
    assert await ids() == ["tafel:fks-erste-fuehrung"]
