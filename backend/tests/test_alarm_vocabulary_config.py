"""A station's own alarm vocabulary: `alarmKeywords` in the deployment config.

The shipped `app/data/alarm_keywords.json` is a DEFAULT, not a constant. A station whose alarm
words differ — another language, another Stichwort set, another alerting system — puts its own
vocabulary in the deployment config, and it REPLACES the shipped one wholesale. Three things
this file is here to hold down:

1. **A station that sets nothing must not move.** The first test pins the effective vocabulary
   as literals — every keyword, its German label, the priority list, in order. If a refactor
   changes a single character of what an unconfigured deployment classifies with, this fails.
2. **An invalid vocabulary must be refused at the door, not ignored.** A silently-dropped
   keyword list means alarms classify wrongly and nothing says so; the operator finds out from
   an alarm that did not wake anyone. So every malformed shape below is a load-time error.
3. **The override must actually take effect**, end to end, through the same call the alarm
   intake makes.
"""

import pytest
import pytest_asyncio
from pydantic import ValidationError

from app import alarm_keywords, divera
from app.schemas import DeploymentConfigIn

# What a deployment with NO override classifies with — the literal values as of the rename,
# and as they were before it, plus the six Ausrückordnung Einsatzarten that matched nothing until
# 2026-11-11. Order included: the matcher takes the first hit.
SHIPPED_TITLE_MAP = [
    ("FEUER", "Brandbekämpfung"),
    ("BRAND", "Brandbekämpfung"),
    ("HOCHWASSER", "Elementarereignis"),
    ("UNWETTER", "Elementarereignis"),
    ("STURM", "Elementarereignis"),
    ("VU", "Strassenrettung"),
    ("VERKEHR", "Strassenrettung"),
    ("UNFALL", "Strassenrettung"),
    ("THL", "Technische Hilfeleistung"),
    ("TECH", "Technische Hilfeleistung"),
    ("ÖL", "Ölwehr"),
    ("OELWEHR", "Ölwehr"),
    ("CHEMIE", "Chemiewehr"),
    ("STRAHLEN", "Strahlenwehr"),
    ("BAHN", "Einsatz Bahnanlagen"),
    ("BMA", "BMA / unechte Alarme"),
    ("FEHLALARM", "BMA / unechte Alarme"),
    ("DIENST", "Dienstleistungen"),
    ("TIER", "Gerettete Tiere"),
    ("VERUNREINIGUNG", "Ölwehr"),
    ("WASSERSCHADEN", "Technische Hilfeleistung"),
    ("TÜRÖFFNUNG", "Technische Hilfeleistung"),
    ("HILFELEISTUNG", "Technische Hilfeleistung"),
    ("ELEMENTAR", "Elementarereignis"),
    ("MED USTÜ", "Diverse Einsätze"),
]

SHIPPED_HIGH_PRIORITY = [
    "BRAND", "FEUER", "FEUERALARM", "VOLLBRAND", "RAUCH", "FLAMMEN",
    "BMA", "BRANDMELDEANLAGE", "BRANDMELDER", "RAUCHMELDER",
    "PERSON IN", "PERSON IM", "EINGEKLEMMT", "EINGESCHLOSSEN", "ABSTURZ", "VERMISST",
    "BEWUSSTLOS", "VERLETZT",
    "VU", "VERKEHRSUNFALL",
    "GAS", "GASGERUCH", "GASAUSTRITT", "GASLECK", "CHEMIE", "CHEMIKALIEN", "GEFAHRGUT",
    "GEFAHRSTOFF",
    "MED USTÜ", "MED.", "MEDIZINISCH", "REANIMATION", "NOTARZT", "RETTUNGSDIENST",
    "EXPLOSION", "DETONATION",
    "EINSTURZ", "EINGESTÜRZT",
    "LIFT", "AUFZUG", "FAHRSTUHL",
]  # fmt: skip


def a_valid_vocabulary(**overrides) -> dict:
    """A minimal but complete station vocabulary — the shape of the shipped file."""
    doc = {
        "schema": "alarm-keywords/1",
        "schema_version": 1,
        "_readme": ["Feuerwehr Musterdorf's own words."],
        "keyword_to_category": {"pairs": [["INCENDIE", "brandbekaempfung"], ["ACCIDENT", "strassenrettung"]]},
        "fallback_category": "diverse_einsaetze",
        "high_priority_keywords": {"groups": [{"group": "Feu", "keywords": ["INCENDIE", "FUMÉE"]}]},
    }
    doc.update(overrides)
    return doc


@pytest.fixture(autouse=True)
def _clean_cache():
    divera.reset_vocabulary_cache()
    yield
    divera.reset_vocabulary_cache()


@pytest_asyncio.fixture
async def config_row(monkeypatch, session_factory):
    """Point `active_vocabulary()`'s own session at the test database and write the row."""
    import app.database

    monkeypatch.setattr(app.database, "async_session_maker", session_factory)

    async def _write(config_json: dict) -> None:
        from app.models import DeploymentConfig

        async with session_factory() as db:
            db.add(DeploymentConfig(id=1, config_json=config_json))
            await db.commit()
        divera.reset_vocabulary_cache()

    return _write


# --- 1. No override: nothing moves ---------------------------------------------------


def test_the_shipped_vocabulary_is_character_for_character_unchanged():
    vocab = alarm_keywords.SHIPPED
    assert [(kw, divera.category_label(cat)) for kw, cat in vocab.keyword_to_category] == SHIPPED_TITLE_MAP
    assert list(vocab.high_priority_keywords) == SHIPPED_HIGH_PRIORITY
    assert vocab.fallback_category == "diverse_einsaetze"


@pytest.mark.asyncio
async def test_a_deployment_that_sets_nothing_gets_the_shipped_vocabulary(config_row):
    await config_row({"identity": {"appName": "Feuerwehr Musterdorf"}})
    assert await divera.active_vocabulary() is alarm_keywords.SHIPPED


@pytest.mark.asyncio
async def test_no_database_at_all_still_classifies(monkeypatch):
    """The alarm path must survive a config lookup that cannot happen."""
    import app.database

    def _boom():
        raise RuntimeError("no database")

    monkeypatch.setattr(app.database, "async_session_maker", _boom)
    assert await divera.active_vocabulary() is alarm_keywords.SHIPPED


# --- 2. An invalid vocabulary is refused, never ignored -------------------------------


@pytest.mark.parametrize(
    ("broken", "expected"),
    [
        (a_valid_vocabulary(schema_version=2), "schema_version"),
        (a_valid_vocabulary(keyword_to_category={"pairs": []}), "at least one keyword"),
        (a_valid_vocabulary(keyword_to_category={"pairs": [["feuer", "brandbekaempfung"]]}), "UPPERCASE"),
        (
            a_valid_vocabulary(keyword_to_category={"pairs": [["FEUER", "brandbekaempfung"], ["FEUER", "oelwehr"]]}),
            "duplicate",
        ),
        (a_valid_vocabulary(keyword_to_category={"pairs": [["FEUER", "waldbrand"]]}), "no label for"),
        (a_valid_vocabulary(fallback_category="etwas_anderes"), "no label for"),
        (
            a_valid_vocabulary(high_priority_keywords={"groups": [{"keywords": ["rauch"]}]}),
            "UPPERCASE",
        ),
    ],
)
def test_an_invalid_vocabulary_fails_the_config_load(broken: dict, expected: str):
    """Not «logged and skipped» — the whole document is rejected and nothing is written."""
    with pytest.raises(ValidationError) as e:
        DeploymentConfigIn(alarmKeywords=broken)
    assert expected in str(e.value)


def test_a_missing_required_field_fails_the_config_load():
    incomplete = a_valid_vocabulary()
    del incomplete["fallback_category"]
    with pytest.raises(ValidationError):
        DeploymentConfigIn(alarmKeywords=incomplete)


def test_the_shipped_file_itself_validates_as_a_deployment_vocabulary():
    """A station's documented starting point is a copy of the shipped file — so it must pass
    the config door unchanged, or the instruction in the docs is a lie."""
    import json

    raw = json.loads(alarm_keywords.DATA_PATH.read_text(encoding="utf-8"))
    doc = DeploymentConfigIn(alarmKeywords=raw)
    assert doc.alarmKeywords is not None
    assert [tuple(p) for p in doc.alarmKeywords.keyword_to_category.pairs] == list(
        alarm_keywords.SHIPPED.keyword_to_category
    )


# --- 3. A set vocabulary actually classifies ------------------------------------------


@pytest.mark.asyncio
async def test_a_station_vocabulary_replaces_the_shipped_one_wholesale(config_row):
    normalized = DeploymentConfigIn(alarmKeywords=a_valid_vocabulary()).model_dump(mode="json")
    await config_row(normalized)

    vocab = await divera.active_vocabulary()
    assert [kw for kw, _ in vocab.keyword_to_category] == ["INCENDIE", "ACCIDENT"]
    assert divera.detect_type("INCENDIE bâtiment", vocab=vocab) == "Brandbekämpfung"
    assert divera.infer_priority("FUMÉE dense", vocab=vocab) == "HIGH"
    # Wholesale, not merged: the shipped words are gone for this station.
    assert divera.detect_type("Brand Wohnhaus", vocab=vocab) == "Diverse Einsätze"
    assert divera.infer_priority("Wohnungsbrand", vocab=vocab) == "LOW"


@pytest.mark.asyncio
async def test_a_row_edited_around_the_validator_degrades_loudly(config_row, caplog):
    """Only reachable by editing the database directly — the API and CLI both refuse it."""
    await config_row({"alarmKeywords": {"schema_version": 1, "keyword_to_category": {"pairs": [["feuer", "x"]]}}})
    with caplog.at_level("ERROR"):
        vocab = await divera.active_vocabulary()
    assert vocab is alarm_keywords.SHIPPED
    assert "alarmKeywords is invalid" in caplog.text


# --- 4. Which vocabulary is running is answerable from outside -------------------------


@pytest.mark.asyncio
async def test_get_config_says_which_vocabulary_is_running(client):
    r = await client.get("/api/config")
    assert r.status_code == 200
    status = r.json()["alarmVocabulary"]
    assert status["source"] == "shipped"
    assert status["titleKeywords"] == len(SHIPPED_TITLE_MAP)
    assert status["highPriorityKeywords"] == len(SHIPPED_HIGH_PRIORITY)


@pytest.mark.asyncio
async def test_get_config_says_when_the_station_brought_its_own(client, admin_login, put_config):
    await admin_login(client)
    r = await put_config(client, {"alarmKeywords": a_valid_vocabulary()})
    assert r.status_code == 200, r.text
    assert r.json()["alarmVocabulary"] == {
        "source": "deployment",
        "schemaVersion": 1,
        "titleKeywords": 2,
        "highPriorityKeywords": 2,
        "fallbackCategory": "diverse_einsaetze",
    }

    r = await client.get("/api/config")
    assert r.json()["alarmVocabulary"]["source"] == "deployment"


@pytest.mark.asyncio
async def test_put_config_rejects_an_invalid_vocabulary(client, admin_login, put_config):
    await admin_login(client)
    broken = a_valid_vocabulary(keyword_to_category={"pairs": [["feuer", "brandbekaempfung"]]})
    r = await put_config(client, {"alarmKeywords": broken})
    assert r.status_code == 422
