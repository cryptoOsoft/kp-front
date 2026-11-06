"""Station config values whose stored form did not match what the app promised.

The first ones were found by an audit of the in-app help: the copy stated them as facts a station
could change, and in each case the shipped path made that false. The Rückzug-line bounds are the
same class of gap from the other end — the field accepted values the safety logic cannot honour.
"""

import pytest
from pydantic import ValidationError

from app.admin_config import EXAMPLE_CONFIG
from app.schemas import DeploymentConfigIn, load_stored_config


def test_the_air_estimate_numbers_survive_a_save():
    """The Truppkarte says «geschätzt mit 7 L Flasche und 50 L/min», which reads like a station
    setting. It was not one: `extra="ignore"` dropped both fields on the way in, so a Wehr with
    9-litre cylinders got the shipped estimate anyway — and that estimate is what an Überwacher
    plans a relief against."""
    cfg = DeploymentConfigIn.model_validate({"doctrine": {"cylinderLiters": 9, "estConsumptionLPerMin": 65}})
    assert cfg.doctrine.cylinderLiters == 9
    assert cfg.doctrine.estConsumptionLPerMin == 65
    # unset stays unset — the frontend then falls back to the shipped 7 L / 50 L·min⁻¹
    assert DeploymentConfigIn.model_validate({"doctrine": {}}).doctrine.cylinderLiters is None


def test_the_rueckzug_alarm_line_survives_a_save():
    """Killed-app alarms need the same lower line the frontend applies during Rückzug."""
    cfg = DeploymentConfigIn.model_validate({"doctrine": {"alarmBar": 100, "alarmBarRueckzug": 45}})
    assert cfg.doctrine.alarmBarRueckzug == 45
    assert EXAMPLE_CONFIG["doctrine"]["alarmBarRueckzug"] == 50


def test_modul6_ships_as_a_viewer():
    """Modul 6 is a reference PDF you scroll; building annotation lives on the Gebäude
    floor-stack. The frontend fallback and the in-app help have both said so all along — this
    template did not, so a station seeded from it got a drawable Modul 6."""
    modul6 = next(m for m in EXAMPLE_CONFIG["modules"] if m["id"] == "modul6")
    assert modul6.get("viewer") is True


@pytest.mark.parametrize(
    "value",
    [0, -5, 120],
    ids=["cleared-to-zero", "negative", "above-alarmBar"],
)
def test_the_rueckzug_line_cannot_be_cleared_or_inverted(value):
    """The Rückzug line is safety-critical in both directions.

    Zero looks like «switched off» in the Verwaltung and behaves like «never alarm»: push.py only
    sends while `line > 0`, and the frontend's `alarmBarRueckzug ?? alarmBar` keeps the 0 because
    `0 ?? x` is `0` — so a cleared field kills the low-pressure alarm on the server AND on the
    tablet. Above `alarmBar` it inverts the tiers instead — the Trupp already ordered out would
    alarm earlier than one still working, which is the nagging the second line exists to end."""
    with pytest.raises(ValidationError):
        DeploymentConfigIn.model_validate({"doctrine": {"alarmBar": 100, "alarmBarRueckzug": value}})


def test_the_rueckzug_line_may_equal_the_bare_alarm():
    """Equal is the documented way to switch the lower line off (src/lib/atemschutz.ts): the app
    then behaves exactly as it did before the setting existed. It must stay accepted."""
    cfg = DeploymentConfigIn.model_validate({"doctrine": {"alarmBar": 100, "alarmBarRueckzug": 100}})
    assert cfg.doctrine.alarmBarRueckzug == 100


def test_zero_alarmdruck_is_allowed_only_on_the_public_demo():
    with pytest.raises(ValidationError):
        DeploymentConfigIn.model_validate({"doctrine": {"alarmBar": 0}})

    cfg = DeploymentConfigIn.model_validate(
        {"identity": {"demoMode": True}, "doctrine": {"alarmBar": 0, "alarmBarRueckzug": 50}}
    )
    assert cfg.doctrine.alarmBar == 0


def test_a_legacy_station_zero_degrades_to_the_safe_defaults_without_losing_config():
    doc = load_stored_config(
        {
            "identity": {"appName": "Feuerwehr Steintal"},
            "doctrine": {"alarmBar": 0, "alarmBarRueckzug": 75},
            "fleet": {"vehicles": [{"id": "tlf-31", "label": "TLF 31"}]},
        }
    )
    assert doc.identity.appName == "Feuerwehr Steintal"
    assert [vehicle.id for vehicle in doc.fleet.vehicles] == ["tlf-31"]
    assert doc.doctrine.alarmBar is None
    assert doc.doctrine.alarmBarRueckzug is None


@pytest.mark.parametrize("value", [-1, 301])
def test_alarmdruck_stays_within_its_supported_range(value):
    with pytest.raises(ValidationError):
        DeploymentConfigIn.model_validate({"doctrine": {"alarmBar": value}})


@pytest.mark.parametrize(
    ("doctrine", "expected"),
    [
        ({"alarmBar": 320, "alarmBarRueckzug": 50}, (None, None)),
        ({"alarmBar": -1}, (None, None)),
        ({"alarmBar": 100, "alarmBarRueckzug": 0}, (100, None)),
        ({"alarmBar": 50, "alarmBarRueckzug": 80}, (50, 50)),
    ],
)
def test_a_stored_pressure_line_out_of_range_never_costs_the_station_its_config(doctrine, expected):
    """The bounds are validators, not `Field(le=…)`, so `load_stored_config` can degrade them.

    Both numbers were unbounded in earlier releases and the cross-field rule is newer still, so
    rows predating either exist. A field constraint runs before every model validator and would
    ignore `context={"stored": True}` — `get_config` would then serve an EMPTY config and the
    station would lose its name, fleet and roster over one doctrine number.
    """
    doc = load_stored_config(
        {
            "identity": {"appName": "Feuerwehr Steintal"},
            "doctrine": doctrine,
            "fleet": {"vehicles": [{"id": "tlf-31", "label": "TLF 31"}]},
        }
    )
    assert doc.identity.appName == "Feuerwehr Steintal"
    assert [vehicle.id for vehicle in doc.fleet.vehicles] == ["tlf-31"]
    assert (doc.doctrine.alarmBar, doc.doctrine.alarmBarRueckzug) == expected


@pytest.mark.parametrize("doctrine", [{"alarmBar": 320}, {"alarmBar": -1}, {"alarmBarRueckzug": 0}])
def test_a_fresh_write_is_still_refused_outright(doctrine):
    """Degrading is for documents already in the database. A PUT is a value being CHOSEN, and
    refusing it costs nothing but a corrected keystroke."""
    with pytest.raises(ValidationError):
        DeploymentConfigIn.model_validate({"doctrine": doctrine})


def test_the_entry_pressure_minimum_survives_a_save():
    """The Eingangsdruck minimum behind the Trupp form's one plausibility question (24.09.2026).
    Declared on the model, or `extra="ignore"` would drop it on save exactly as it once dropped
    the air-estimate numbers — a station setting that looks stored and is not."""
    cfg = DeploymentConfigIn.model_validate({"doctrine": {"entryPressureMin": 250}})
    assert cfg.doctrine.entryPressureMin == 250
    # 0 is a real choice here — «never ask» — not a cleared field
    assert DeploymentConfigIn.model_validate({"doctrine": {"entryPressureMin": 0}}).doctrine.entryPressureMin == 0
    assert DeploymentConfigIn.model_validate({"doctrine": {}}).doctrine.entryPressureMin is None
    assert EXAMPLE_CONFIG["doctrine"]["entryPressureMin"] == 270


@pytest.mark.parametrize("value", [-1, 301])
def test_the_entry_pressure_minimum_stays_in_range(value):
    """A fresh write out of range is refused; a stored one degrades to the shipped value and the
    station keeps the rest of its config."""
    with pytest.raises(ValidationError):
        DeploymentConfigIn.model_validate({"doctrine": {"entryPressureMin": value}})
    doc = load_stored_config({"identity": {"appName": "Feuerwehr Steintal"}, "doctrine": {"entryPressureMin": value}})
    assert doc.identity.appName == "Feuerwehr Steintal"
    assert doc.doctrine.entryPressureMin is None


def test_the_nearby_object_warning_distance_defaults_to_25_m_and_is_bounded():
    """Sweep E.6: the «nicht die Einsatzadresse» warning fired at «0 m entfernt». The station sets
    how far the nearest object may lie before it warns; unset is 25 m."""
    assert DeploymentConfigIn.model_validate({"doctrine": {}}).doctrine.nearbyObjectWarnM == 25
    assert DeploymentConfigIn.model_validate({"doctrine": {"nearbyObjectWarnM": 0}}).doctrine.nearbyObjectWarnM == 0
    for value in (-1, 501):
        with pytest.raises(ValidationError):
            DeploymentConfigIn.model_validate({"doctrine": {"nearbyObjectWarnM": value}})
    # a stored value out of range costs the station this one number, not its configuration
    doc = load_stored_config({"identity": {"appName": "Feuerwehr Steintal"}, "doctrine": {"nearbyObjectWarnM": 900}})
    assert doc.identity.appName == "Feuerwehr Steintal"
    assert doc.doctrine.nearbyObjectWarnM == 25


def test_the_hose_defaults_survive_a_save_and_a_relay_never_starts_on_40():
    """Owner 05.11.2026: a plain Linie is 40 mm, a Wassertransport 75 mm – both station doctrine
    (src/lib/hydraulics · hoseDefaults). Unset serves nothing, so the shipped values apply."""
    cfg = DeploymentConfigIn.model_validate({"doctrine": {"defaultLineHose": "55", "defaultRelayHose": "2x75"}})
    assert (cfg.doctrine.defaultLineHose, cfg.doctrine.defaultRelayHose) == ("55", "2x75")
    unset = DeploymentConfigIn.model_validate({"doctrine": {}})
    assert (unset.doctrine.defaultLineHose, unset.doctrine.defaultRelayHose) == (None, None)
    for doctrine in ({"defaultLineHose": "90"}, {"defaultRelayHose": "40"}, {"defaultLineHose": 75}):
        with pytest.raises(ValidationError):
            DeploymentConfigIn.model_validate({"doctrine": doctrine})


@pytest.mark.parametrize("doctrine", [{"contactIntervalMin": 0}, {"contactIntervalMin": 31}, {"contactGraceSec": 301}])
def test_the_contact_clock_stays_in_the_station_range(doctrine):
    """1–30 min and 0–300 s (owner, 26.10.2026, audit F02): refused on a save, degraded to the
    shipped value when an older stored row holds it."""
    ok = DeploymentConfigIn.model_validate({"doctrine": {"contactIntervalMin": 30, "contactGraceSec": 0}})
    assert (ok.doctrine.contactIntervalMin, ok.doctrine.contactGraceSec) == (30, 0)
    with pytest.raises(ValidationError):
        DeploymentConfigIn.model_validate({"doctrine": doctrine})
    stored = load_stored_config({"identity": {"appName": "Feuerwehr Steintal"}, "doctrine": doctrine})
    assert stored.identity.appName == "Feuerwehr Steintal"
    assert (stored.doctrine.contactIntervalMin, stored.doctrine.contactGraceSec) == (None, None)
