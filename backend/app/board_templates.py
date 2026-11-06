"""`board-template/1` — the paper forms the Tafel offers as pages (10.10.2026).

A station's board templates (the FKS «Erste Führung» poster and the Handbuch sheets, or its own
copy of them) travel exactly like the checklists: a manifest in the private data repo,
``admin_board_templates push`` uploads each file as the reference dataset ``tafel:<id>`` and
with ``--prune`` deletes what left the manifest, and the Tafel reads them through IndexedDB (src/lib/boardTemplates).
A station set REPLACES the bundled FKS set — it starts as a copy of
``src/data/boardTemplates/fks-erste-fuehrung.json``.

This model is the contract: ``extra="forbid"`` everywhere, so a typo in a station file is refused
at the door (CLI ``validate``, ``PUT /api/reference/tafel:<id>``) instead of being silently
ignored by the app. ``docs/board-template.schema.json`` is generated from it
(``just board-template-schema``) and a pytest fails when the two drift; the client's
``isBoardTemplate`` is the tolerant twin (src/lib/boardTemplate.ts). How a station writes one:
docs/board-templates.md.

What a template describes is layout and labels ONLY. Entered data is keyed by the ids in here
(section, cell, column, row), so a renamed label never loses a word — and a page added to an
Einsatz carries its own snapshot, so a later edit never changes an open or archived Einsatz.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SCHEMA_ID = "board-template/1"

#: section / cell / column / row / page / template ids: lowercase, digits, dashes
Ident = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)]


class LabelSet(BaseModel):
    """A label per language — German is required and is the fallback for the others."""

    model_config = ConfigDict(extra="forbid")

    de: str
    fr: str | None = None
    it: str | None = None
    en: str | None = None


#: one string for every language, or one per language
Label = str | LabelSet


def _unique(ids: list[str], what: str) -> None:
    seen: set[str] = set()
    for i in ids:
        if i in seen:
            raise ValueError(f"{what} «{i}» kommt zweimal vor")
        seen.add(i)


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Ident
    title: Label | None = None
    subtitle: Label | None = None
    #: grid columns the section spans on a two-column page
    span: Literal[1, 2] | None = None
    #: height on paper, in ruled rows (also how many empty rows a table prints)
    height: Annotated[int, Field(ge=1, le=60)] | None = None
    hidden: bool | None = None


class QuadCell(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Ident
    label: Label


class QuadSection(_Section):
    """The Problemerfassung: up to four boxes (Front · Ordnung / Sanität · Spezialprobleme),
    one problem per line."""

    type: Literal["quad"]
    cells: Annotated[list[QuadCell], Field(min_length=1, max_length=4)]
    #: station switch: a ➚ = ➘ per line — off in the FKS poster
    trend: bool | None = None
    #: station switch: a «Stichwort» per line — off in the FKS poster
    tag: bool | None = None
    #: the Einsatz's problems (src/lib/problemLink): every box is a Bereich, its lines show on
    #: every other problem section, and the ticks of a `problems` checklist land in its boxes
    problems: bool | None = None

    @model_validator(mode="after")
    def _ids(self) -> QuadSection:
        _unique([c.id for c in self.cells], "Feld")
        return self


class MapSection(_Section):
    """The Lagekarte: a live mini Karte on screen, a snapshot of the Karte on paper."""

    type: Literal["map"]


class AreaOption(BaseModel):
    """One choice of an ``area`` column: a Bereich, by the id of the problem quad's box."""

    model_config = ConfigDict(extra="forbid")

    id: Ident
    label: Label


class TableColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Ident
    label: Label
    #: text · time («Wann», 1124 → 11:24) · trend (➚ = ➘) · symbol (a printed Signatur) ·
    #: index (the printed number of a fixed row) · area (one of `options`: a problem's Bereich)
    type: Literal["text", "time", "trend", "symbol", "index", "area"] | None = None
    #: the choices of an `area` column
    options: Annotated[list[AreaOption], Field(min_length=1)] | None = None
    #: pre-printed: the value comes from the row (`fixedRows[].cells`), never typed
    fixed: bool | None = None
    #: relative width (default 1)
    w: Annotated[float, Field(gt=0, le=20)] | None = None
    hidden: bool | None = None

    @model_validator(mode="after")
    def _options(self) -> TableColumn:
        if (self.type == "area") != (self.options is not None):
            raise ValueError(f"Spalte «{self.id}»: 'options' gehört genau zu type 'area'")
        if self.options:
            _unique([o.id for o in self.options], "Option")
        return self


class TableRow(BaseModel):
    """A pre-printed row — its fixed cells by column id."""

    model_config = ConfigDict(extra="forbid")

    id: Ident
    cells: dict[str, Label]
    hidden: bool | None = None


class TableSection(_Section):
    type: Literal["table"]
    columns: Annotated[list[TableColumn], Field(min_length=1)]
    fixedRows: list[TableRow] | None = None
    #: may rows be written below the fixed ones (default: yes, unless the table has fixed rows)
    addRows: bool | None = None
    #: pre-fill when the page is added: `vehicles` = the vehicles the Einsatz already knows
    seed: Literal["vehicles"] | None = None
    #: station switch: an «Erledigt» tick per row — off in the FKS poster
    done: bool | None = None
    #: the Einsatz's problems (src/lib/problemLink): the first text column is the problem, the
    #: trend column its Tendenz, the `area` column its Bereich – shown on every problem section
    problems: bool | None = None

    @model_validator(mode="after")
    def _shape(self) -> TableSection:
        _unique([c.id for c in self.columns], "Spalte")
        if all(c.fixed for c in self.columns):
            raise ValueError(f"Tabelle «{self.id}»: mindestens eine Spalte muss beschreibbar sein")
        fixed = {c.id for c in self.columns if c.fixed}
        rows = self.fixedRows or []
        _unique([r.id for r in rows], "Zeile")
        for r in rows:
            stray = sorted(set(r.cells) - fixed)
            if stray:
                raise ValueError(
                    f"Tabelle «{self.id}», Zeile «{r.id}»: vorgedruckte Werte nur für feste Spalten, nicht für {', '.join(stray)}"
                )
        return self


class TextField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Ident
    label: Label | None = None
    #: plus / minus = the green / red boxes of a Variante, shade = the grey «given» box
    tone: Literal["plus", "minus", "shade"] | None = None
    type: Literal["text", "time"] | None = None


class TextSection(_Section):
    """Free text fields (the Konzept's Auftrag, Varianten, Antrag …)."""

    type: Literal["text"]
    fields: Annotated[list[TextField], Field(min_length=1, max_length=6)]
    #: stack = one under the other · row = side by side · split = the first on top, the rest
    #: side by side under it (a Variante with its + and –)
    layout: Literal["stack", "row", "split"] | None = None

    @model_validator(mode="after")
    def _ids(self) -> TextSection:
        _unique([f.id for f in self.fields], "Feld")
        return self


#: what a `live` section can show, and the columns each source has (src/lib/boardTemplate ·
#: LIVE_COLUMNS) — a station renames, reorders, re-weighs or hides them, never invents one
LIVE_COLUMNS: dict[str, tuple[str, ...]] = {"pendenzen": ("was", "wer", "prio", "status", "zeit")}


class LiveColumn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Ident
    label: Label
    #: relative width (default 1)
    w: Annotated[float, Field(gt=0, le=20)] | None = None
    hidden: bool | None = None


class LiveSection(_Section):
    """A table DERIVED from the Einsatz, not written on the page (05.11.2026): `pendenzen` lists
    every Pendenz and Erinnerung of the Verlauf. A build that predates it keeps the page and draws
    it without this section."""

    type: Literal["live"]
    source: Literal["pendenzen"]
    columns: Annotated[list[LiveColumn], Field(min_length=1)]

    @model_validator(mode="after")
    def _cols(self) -> LiveSection:
        _unique([c.id for c in self.columns], "Spalte")
        known = LIVE_COLUMNS[self.source]
        stray = [c.id for c in self.columns if c.id not in known]
        if stray:
            raise ValueError(
                f"Abschnitt «{self.id}»: unbekannte Spalte {', '.join(stray)} – möglich sind {', '.join(known)}"
            )
        return self


Section = Annotated[QuadSection | MapSection | TableSection | TextSection | LiveSection, Field(discriminator="type")]


class TemplatePage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: Ident
    title: Label
    #: a sheet number («8.1») — metadata only, never shown
    code: str | None = None
    paper: Literal["portrait", "landscape"] | None = None
    columns: Literal[1, 2] | None = None
    #: station switch: the header line Einsatz · Adresse · Alarm · Einsatzleiter — off in FKS
    header: bool | None = None
    #: station switch: not offered under «+ Seite»
    hidden: bool | None = None
    #: the page may be added more than once — each its own page («Konzept», «Konzept 2», …), for
    #: a sheet an Einsatz fills again and again (a second Konzept, the next Rapport)
    repeatable: bool | None = None
    sections: Annotated[list[Section], Field(min_length=1)]

    @model_validator(mode="after")
    def _ids(self) -> TemplatePage:
        _unique([s.id for s in self.sections], "Abschnitt")
        return self


class BoardTemplate(BaseModel):
    """One `board-template/1` file: a set of pages a station's Tafel offers."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    schema_: Literal["board-template/1"] = Field(alias="schema")
    id: Ident
    version: Annotated[int, Field(ge=1)]
    title: Label
    source: str | None = None
    pages: Annotated[list[TemplatePage], Field(min_length=1)]

    @model_validator(mode="after")
    def _ids(self) -> BoardTemplate:
        _unique([p.id for p in self.pages], "Seite")
        return self


def template_json_schema() -> dict[str, Any]:
    """The committed docs/board-template.schema.json (a pytest pins the two together)."""
    schema = BoardTemplate.model_json_schema(by_alias=True)
    schema["$id"] = SCHEMA_ID
    return schema


def board_template_problem(data: Any) -> str | None:
    """The first thing wrong with a parsed template, as a sentence an admin can act on (German,
    like the checklists' `template_problem`) — None when it is a valid `board-template/1`."""
    if not isinstance(data, dict):
        return "Vorlage ist kein JSON-Objekt"
    if data.get("schema") != SCHEMA_ID:
        return f"«schema» muss «{SCHEMA_ID}» sein"
    try:
        BoardTemplate.model_validate(data)
    except ValidationError as e:
        errs = e.errors()
        # a label is `str | LabelSet`: pydantic reports both branches — the «not a string» one says
        # nothing an admin can use when they wrote an object, so the object's own error wins
        err = next((x for x in errs if "str" not in x["loc"]), errs[0])
        where = ".".join(str(p) for p in err["loc"])
        return f"{where}: {err['msg']}" if where else err["msg"]
    return None


def parse_board_template(raw: bytes | str) -> BoardTemplate:
    """Bytes → a validated template, or ValueError with the sentence an admin reads."""
    try:
        data = json.loads(raw)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Vorlage ist kein gültiges JSON: {e}") from e
    problem = board_template_problem(data)
    if problem:
        raise ValueError(problem)
    return BoardTemplate.model_validate(data)
