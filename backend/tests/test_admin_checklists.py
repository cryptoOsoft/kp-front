"""Unit tests for the checklists-as-code manifest loader + the reference-API checklist helpers
(no DB, no network).

Covers the pure layers: manifest parsing/validation (ids, kinds, assets), template-file shape
checks, and the API's `checklists:` id classification + template-shape guard. Run `uv run pytest`.
"""

import json

import pytest

from app.admin_checklists import (
    ChecklistEntry,
    _expected_ids,
    _read_manifest,
    _template_bytes,
    _validate_files,
)
from app.api.reference import _checklist_role, _validate_checklist_template


def _write(tmp_path, name, obj):
    p = tmp_path / name
    p.write_text(json.dumps(obj), encoding="utf-8")
    return p


# --- manifest parsing -------------------------------------------------------------------


def test_reads_list_and_checklists_wrapper(tmp_path):
    entry = {"id": "fu", "kind": "action", "title": "FU", "file": "fu.json"}
    assert len(_read_manifest(_write(tmp_path, "a.json", [entry]))) == 1
    assert len(_read_manifest(_write(tmp_path, "b.json", {"checklists": [entry]}))) == 1


def test_duplicate_id_rejected(tmp_path):
    m = _write(
        tmp_path,
        "m.json",
        [
            {"id": "x", "kind": "action", "title": "A", "file": "a.json"},
            {"id": "x", "kind": "action", "title": "B", "file": "b.json"},
        ],
    )
    with pytest.raises(SystemExit):
        _read_manifest(m)


def test_unknown_key_rejected(tmp_path):
    m = _write(tmp_path, "m.json", [{"id": "x", "kind": "action", "title": "A", "file": "a.json", "typo": 1}])
    with pytest.raises(SystemExit):
        _read_manifest(m)


def test_id_with_colon_rejected():
    # ':' is the reference-dataset id separator (checklists:<id>:p<N>) — an entry id must not use it.
    with pytest.raises(ValueError):
        ChecklistEntry(id="bad:id", kind="action", title="A", file="a.json")


def test_unknown_kind_and_bad_file_rejected():
    with pytest.raises(ValueError):
        ChecklistEntry(id="x", kind="mystery", title="A", file="a.json")
    with pytest.raises(ValueError):
        ChecklistEntry(id="x", kind="action", title="A", file="a.pdf")  # not .json


def test_assets_only_on_reference():
    asset = {"page": 12, "file": "assets/p12.jpg"}
    # a reference template may carry diagram assets…
    ChecklistEntry(id="pb", kind="reference", title="PB", file="pb.json", assets=[asset])
    # …but an action list may not
    with pytest.raises(ValueError):
        ChecklistEntry(id="fu", kind="action", title="FU", file="fu.json", assets=[asset])


def test_duplicate_asset_page_rejected():
    with pytest.raises(ValueError):
        ChecklistEntry(
            id="pb",
            kind="reference",
            title="PB",
            file="pb.json",
            assets=[{"page": 4, "file": "assets/p4.jpg"}, {"page": 4, "file": "assets/p4b.jpg"}],
        )


# --- template-file validation (checks the referenced JSON, not just the manifest) --------


def test_validate_files_checks_template_shape(tmp_path):
    _write(
        tmp_path,
        "fu.json",
        {"id": "fu", "kind": "action", "title": "FU", "phases": [{"id": "p", "title": "P", "items": []}]},
    )
    m = _write(tmp_path, "m.json", [{"id": "fu", "kind": "action", "title": "FU", "file": "fu.json"}])
    entries = _read_manifest(m)
    assert _validate_files(m, entries) == (1, 0)


def test_validate_files_rejects_id_mismatch(tmp_path):
    _write(
        tmp_path,
        "fu.json",
        {"id": "other", "kind": "action", "title": "FU", "phases": [{"id": "p", "title": "P", "items": []}]},
    )
    m = _write(tmp_path, "m.json", [{"id": "fu", "kind": "action", "title": "FU", "file": "fu.json"}])
    entries = _read_manifest(m)
    with pytest.raises(SystemExit):
        _validate_files(m, entries)


def test_validate_files_missing_template(tmp_path):
    m = _write(tmp_path, "m.json", [{"id": "fu", "kind": "action", "title": "FU", "file": "nope.json"}])
    entries = _read_manifest(m)
    with pytest.raises(SystemExit):
        _validate_files(m, entries)


# --- prune reconciliation ---------------------------------------------------------


def test_expected_ids_covers_templates_and_assets():
    entries = [
        ChecklistEntry(id="fu", kind="action", title="FU", file="fu.json"),
        ChecklistEntry(
            id="pb",
            kind="reference",
            title="PB",
            file="pb.json",
            assets=[{"page": 4, "file": "a/p4.jpg"}, {"page": 9, "file": "a/p9.jpg"}],
        ),
    ]
    assert _expected_ids(entries) == {"checklists:fu", "checklists:pb", "checklists:pb:p4", "checklists:pb:p9"}
    # a dataset id NOT produced here (e.g. a renamed template's old id) is what prune deletes.
    assert "checklists:el-playbook" not in _expected_ids(entries)


# --- config-driven order injection ------------------------------------------------


def test_template_bytes_stamps_order(tmp_path):
    src = _write(tmp_path, "fu.json", {"id": "fu", "kind": "action", "title": "FU", "phases": [{"id": "p"}]})
    out = json.loads(_template_bytes(src, 3))
    assert out["order"] == 3
    # source file is untouched (order only in the served copy)
    assert "order" not in json.loads(src.read_text())


def test_manifest_entry_order_optional():
    assert ChecklistEntry(id="fu", kind="action", title="FU", file="fu.json").order is None
    assert ChecklistEntry(id="fu", kind="action", title="FU", file="fu.json", order=2).order == 2


# --- reference-API helpers --------------------------------------------------------------


def test_checklist_role_classification():
    assert _checklist_role("checklists:fu-aktion") == "template"
    assert _checklist_role("checklists:el-playbook:p12") == "asset"
    assert _checklist_role("geo:hydrant") is None
    assert _checklist_role("plan:abc:modul1") is None


def test_validate_checklist_template_accepts_valid():
    _validate_checklist_template(
        json.dumps({"id": "fu", "kind": "action", "title": "FU", "phases": [{"id": "p"}]}).encode()
    )
    _validate_checklist_template(
        json.dumps({"id": "pb", "kind": "reference", "title": "PB", "entries": [{"id": "e"}]}).encode()
    )


def test_validate_checklist_template_rejects_bad():
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        _validate_checklist_template(b"not json")
    with pytest.raises(HTTPException):
        _validate_checklist_template(
            json.dumps({"id": "fu", "kind": "action", "title": "FU"}).encode()
        )  # neither phases nor entries
    with pytest.raises(HTTPException):
        # both phases and entries → ambiguous
        _validate_checklist_template(
            json.dumps({"id": "x", "kind": "action", "title": "X", "phases": [{}], "entries": [{}]}).encode()
        )


# --- Anleitungen (kind: manual, 05.10.2026) ---------------------------------------------

from app.checklist_templates import manual_pages, template_problem  # noqa: E402

MANUAL = {
    "id": "stromerzeuger",
    "kind": "manual",
    "title": "Stromerzeuger starten",
    "device": "Stromerzeuger 8 kVA",
    "updated": "2026-10-05",
    "keywords": ["generator"],
    "steps": [
        {"text": "Standort wählen", "warning": "Nie in Räumen", "details": ["eben", "im Freien"]},
        {"text": "Starten", "hint": "Choke", "images": [{"page": 1, "caption": "Bedienfeld"}]},
    ],
}


def test_manual_template_is_valid():
    assert template_problem(MANUAL) is None
    assert manual_pages(MANUAL) == {1}


@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"device": ""}, "device"),
        ({"steps": []}, "Schritt"),
        ({"steps": [{"text": " "}]}, "Schritt 1"),
        ({"steps": [{"text": "a", "warning": 3}]}, "warning"),
        ({"steps": [{"text": "a", "details": "x"}]}, "details"),
        ({"steps": [{"text": "a", "details": [" "]}]}, "details"),
        ({"steps": [{"text": "a", "images": [{"page": -1}]}]}, "page"),
        ({"steps": [{"text": "a", "images": [{"page": True}]}]}, "page"),
        ({"steps": [{"text": "a", "images": "p1"}]}, "images"),
        ({"updated": "5.10.2026"}, "Datum"),
        ({"keywords": "generator"}, "keywords"),
        ({"phases": [{"id": "p"}]}, "steps"),
        ({"cover": -1}, "cover"),
        ({"cover": "p2"}, "cover"),
    ],
)
def test_manual_template_problems(patch, needle):
    problem = template_problem({**MANUAL, **patch})
    assert problem is not None and needle in problem


def test_manual_upload_shape_check():
    from fastapi import HTTPException

    _validate_checklist_template(json.dumps(MANUAL).encode())
    with pytest.raises(HTTPException):
        _validate_checklist_template(json.dumps({**MANUAL, "steps": []}).encode())


def test_manual_may_carry_assets():
    entry = ChecklistEntry(
        id="stromerzeuger", kind="manual", title="S", file="s.json", assets=[{"page": 1, "file": "a/p1.svg"}]
    )
    assert [(a.page, a.file) for a in entry.assets] == [(1, "a/p1.svg")]


def test_validate_files_manual_needs_an_asset_for_every_step_image(tmp_path):
    _write(tmp_path, "s.json", MANUAL)
    (tmp_path / "p1.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    entry = {"id": "stromerzeuger", "kind": "manual", "title": "S", "file": "s.json"}
    ok = _write(tmp_path, "ok.json", [{**entry, "assets": [{"page": 1, "file": "p1.svg"}]}])
    assert _validate_files(ok, _read_manifest(ok)) == (1, 1)
    missing = _write(tmp_path, "missing.json", [entry])
    with pytest.raises(SystemExit):
        _validate_files(missing, _read_manifest(missing))


def test_validate_files_manual_cover_needs_its_asset(tmp_path):
    # the cover may be a photo no step shows – but it must be uploaded like one
    _write(tmp_path, "s.json", {**MANUAL, "cover": 2})
    (tmp_path / "p1.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
    entry = {"id": "stromerzeuger", "kind": "manual", "title": "S", "file": "s.json"}
    without = _write(tmp_path, "without.json", [{**entry, "assets": [{"page": 1, "file": "p1.svg"}]}])
    with pytest.raises(SystemExit):
        _validate_files(without, _read_manifest(without))
    both = [{"page": 1, "file": "p1.svg"}, {"page": 2, "file": "p1.svg"}]
    ok = _write(tmp_path, "ok.json", [{**entry, "assets": both}])
    assert _validate_files(ok, _read_manifest(ok)) == (1, 2)


def test_demo_manifest_validates():
    """The demo data (examples/demo-data) carries two Anleitungen with step pictures — it must
    stay loadable, it is what `just demo-load` and the nightly demo reset push."""
    from pathlib import Path

    manifest = Path(__file__).resolve().parents[2] / "examples" / "demo-data" / "checklists.manifest.json"
    entries = _read_manifest(manifest)
    assert {e.kind for e in entries} >= {"manual"}
    _validate_files(manifest, entries)


PROBLEMS = {
    "id": "problemerfassung",
    "kind": "action",
    "title": "Problemerfassung",
    "problems": True,
    "phases": [
        {"id": "front", "title": "Front", "area": "front", "items": [{"id": "f1", "text": "Energieträger"}]},
        {"id": "weiteres", "title": "Weiteres", "items": [{"id": "w1", "text": "Medien"}]},
    ],
}


def test_problem_checklist_is_valid():
    """A `problems` list: a tick is a problem for the Tafel, a phase names its Bereich (or none)."""
    assert template_problem(PROBLEMS) is None


@pytest.mark.parametrize(
    ("patch", "needle"),
    [
        ({"problems": "ja"}, "true/false"),
        ({"kind": "rapport"}, "kind 'action'"),
        ({"problems": False}, "'problems': true"),
        ({"phases": [{"id": "f", "title": "F", "area": "Spezielles", "items": []}]}, "Feld-id"),
    ],
)
def test_problem_checklist_problems(patch, needle):
    problem = template_problem({**PROBLEMS, **patch})
    assert problem is not None and needle in problem
