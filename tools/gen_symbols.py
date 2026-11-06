#!/usr/bin/env python3
"""Generate the KP-Front-authored tactical symbol pack.

Own artwork following the Swiss FKS Faltkarte sign conventions — geometric primitives
(circles, polylines, letters), NOT the FireGIS path data (their circles are 48-segment
arc chains; ours are real <circle> elements). Names/categories stay verbatim from the
FireGIS pack this replaced; the shipped output is public/tactical-symbols.json (the old
public/firegis-symbols.json no longer exists in the repo).

Contract: origin-centered viewBox, unit radius ≈ 1, no width/height,
colors baked (#000000 = glyph, first non-black = accent for symColor()), outline-only
symbols carry the literal fill="none" (needsWhite() chip), letters use
dominant-baseline="central" (the loader rewrites it for Safari).

Usage:
  python3 tools/gen_symbols.py emit     # (re)write public/tactical-symbols.json — the shipped pack
  python3 tools/gen_symbols.py review   # tools/symbols-review.html (vs. the FireGIS pack when present)
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# --- palette (matches the conventions the crews learned) -----------------------------
BLACK = "#000000"
BLUE = "#00a0ff"      # persons / zones / Führung outline blue
VBLUE = "#006dff"     # vehicle outline blue
ORANGE = "#ff8000"
RED = "#ff0000"
YELLOW = "#ffff00"
GREEN = "#008040"
WATER = "#0000ff"
GREY = "#6b7280"      # Rauch (smoke)


# --- tiny SVG builder -----------------------------------------------------------------
def fnum(v: float) -> str:
    s = f"{v:.2f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def path(pts, stroke=BLACK, sw=0.06, fill="none", close=False, cap=None) -> str:
    d = "M " + " L ".join(f"{fnum(x)} {fnum(y)}" for x, y in pts) + (" Z" if close else "")
    capattr = f' stroke-linecap="{cap}"' if cap else ""
    return (f'<path d="{d}" fill="{fill}" stroke="{stroke}" '
            f'stroke-width="{fnum(sw)}" stroke-linejoin="round"{capattr}/>')


def line(x1, y1, x2, y2, stroke=BLACK, sw=0.06, cap=None) -> str:
    return path([(x1, y1), (x2, y2)], stroke=stroke, sw=sw, cap=cap)


def circle(cx, cy, r, stroke=BLACK, sw=0.06, fill="none") -> str:
    return (f'<circle cx="{fnum(cx)}" cy="{fnum(cy)}" r="{fnum(r)}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{fnum(sw)}"/>')


def text(t, fs, fill=BLACK, x=0.0, y=0.0) -> str:
    return (f'<text x="{fnum(x)}" y="{fnum(y)}" text-anchor="middle" dominant-baseline="central" '
            f'font-family="Arial,sans-serif" font-weight="bold" font-size="{fnum(fs)}" '
            f'fill="{fill}">{t}</text>')


def svg(elements, vb=2.6, viewbox: str | None = None) -> str:
    box = viewbox or f"{fnum(-vb / 2)} {fnum(-vb / 2)} {fnum(vb)} {fnum(vb)}"
    return (f'<svg viewBox="{box}" xmlns="http://www.w3.org/2000/svg" '
            f'preserveAspectRatio="xMidYMid meet">' + "".join(elements) + "</svg>")


# --- shared sign parts ----------------------------------------------------------------
def vehicle_body(stroke, sw):
    """FKS vehicle: rectangle with a chevron nose at the front (right)."""
    return [
        path([(-1, -0.4), (1, -0.4), (1, 0.4), (-1, 0.4)], stroke=stroke, sw=sw, close=True),
        line(0.46, -0.4, 0.46, 0.4, stroke=stroke, sw=sw),
        path([(0.46, -0.4), (1, 0), (0.46, 0.4)], stroke=stroke, sw=sw),
    ]


def letter_disc(letter, fill):
    """Schadenlage disc: colored circle, black outline, big black letter."""
    return svg([circle(0, 0, 1, stroke=BLACK, sw=0.06, fill=fill), text(letter, 1.5)], vb=2.6)


def smoke(fill=GREY):
    """Rauch: a grey four-lobe smoke puff (the same silhouette as the app's cloud glyph),
    black outline like the other Schadenlage signs; fill-opacity keeps it reading as smoke."""
    d = ("M -0.624 0.624 Q -0.984 0.624 -0.984 0.288 Q -0.984 -0.024 -0.648 0 "
         "Q -0.648 -0.384 -0.24 -0.36 Q -0.024 -0.624 0.288 -0.408 "
         "Q 0.696 -0.456 0.672 -0.048 Q 0.984 0 0.888 0.336 Q 0.792 0.624 0.432 0.624 Z")
    puff = (f'<path d="{d}" fill="{fill}" fill-opacity="0.6" stroke="{BLACK}" '
            f'stroke-width="0.06" stroke-linejoin="round" stroke-linecap="round"/>')
    return svg([puff], vb=2.6)


def zone_circle(label):
    """Bereich: open blue circle with the unit label."""
    return svg([circle(0, 0, 1, stroke=BLUE, sw=0.1), text(label, 0.8, fill=BLUE)], vb=2.6)


def placard(label, fill, w=1.0, h=0.55, fs=0.75):
    """A wall-mounted installation plate, drawn exactly as it is printed on a Swiss Feuerwehr-
    Einsatzplan (ISO 23601 / VKF Piktogramm style): a coloured rectangle with its Kürzel — BMA-Z,
    RWA-BS, FA, AED. Same grammar as the Schadenlage `letter_disc` (colour marks the category,
    the black outline + black bold text is the identifying mark), just rectangular instead of
    round because that is the shape every one of these placards actually has on the wall."""
    margin = 0.15
    return svg(
        [path([(-w, -h), (w, -h), (w, h), (-w, h)], stroke=BLACK, sw=0.06, fill=fill, close=True),
         text(label, fs)],
        viewbox=f"{fnum(-w - margin)} {fnum(-h - margin)} {fnum(2 * (w + margin))} {fnum(2 * (h + margin))}",
    )


def holding_box(letter):
    """Sammelplatz / Warteraum: wide open rectangle with a big letter."""
    return svg(
        [path([(-2, -1.3), (2, -1.3), (2, 1.3), (-2, 1.3)], stroke=BLUE, sw=0.1, close=True),
         text(letter, 2.0, fill=BLUE)],
        viewbox="-2.2 -2.3 4.6 4.6",
    )


def hazard_triangle(extra, viewbox="-1.3 -1.4 2.6 2.6"):
    """Gefahren warning triangle (orange, apex up) with content inside."""
    tri = path([(0, -0.9), (-1, 0.7), (1, 0.7)], stroke=ORANGE, sw=0.1, close=True)
    return svg([tri] + extra, viewbox=viewbox)


def person_post(extra):
    """Personen tall rectangle (Sammelstelle family) with distinguishing content."""
    box = path([(-0.4, -1), (0.4, -1), (0.4, 1), (-0.4, 1)], stroke=BLUE, sw=0.1, close=True)
    return svg([box] + extra, vb=2.6)


def _rot(pts, deg):
    """Rotate points about the origin — for the radially repeated parts of a sign."""
    import math

    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(x * ca - y * sa, x * sa + y * ca) for x, y in pts]


def gear(color, teeth=8):
    """FKS Schlüsselstelle: a solid ring with radial teeth (Vegetationsbrand-Handbuch S. 52).

    A stroked circle rather than a filled annulus — the ring width IS the stroke, so the open
    centre stays open at every size without a fill-rule the renderers would each have to honour.
    The first tooth points UP, as it does on the sheet."""
    tooth = [(0.62, -0.21), (1.0, -0.13), (1.0, 0.13), (0.62, 0.21)]
    return [circle(0, 0, 0.6, stroke=color, sw=0.28)] + [
        path(_rot(tooth, -90 + i * (360 / teeth)), stroke=color, sw=0.02, fill=color, close=True)
        for i in range(teeth)
    ]


def basin(fill_color, sw):
    """Open water basin: filled trapezoid with flaring rim lines (Löschweier family)."""
    return [
        path([(-0.55, 0.6), (-0.75, 0.25), (0.75, 0.25), (0.55, 0.6)],
             stroke=fill_color, sw=sw, fill=fill_color, close=True),
        line(0.75, 0.25, 1.1, -0.35, stroke=fill_color, sw=sw),
        line(-0.75, 0.25, -1.1, -0.35, stroke=fill_color, sw=sw),
    ]


# --- the pack -------------------------------------------------------------------------
# (cat, name, svg) — names verbatim from the current pack (compatibility keys).
def build() -> list[dict]:
    syms: list[tuple[str, str, str]] = []
    add = lambda cat, name, s: syms.append((cat, name, s))  # noqa: E731

    # ── Schadenlage
    add("Schadenlage", "VKF Feuer", letter_disc("F", RED))
    add("Schadenlage", "VKF Rauch", smoke())
    add("Schadenlage", "VKF Rettungen", letter_disc("R", YELLOW))
    add("Schadenlage", "VKF Unfall", letter_disc("U", GREEN))
    add("Schadenlage", "VKF Gefaehrliche Stoffe", letter_disc("C", ORANGE))
    add("Schadenlage", "VKF Wasser", letter_disc("W", WATER))

    # damage / Naturereignis signatures (FKS Faltkarte 11/2022: red diagonal-cross lattices —
    # the stroke count per direction encodes severity — and the Überschwemmung ellipse+arrow)
    def lattice(offsets):
        els = []
        for o in offsets:
            els.append(path([(-0.8 + o, -0.8 - o), (0.8 + o, 0.8 - o)], stroke=RED, sw=0.1, cap="round"))
            els.append(path([(0.8 + o, -0.8 - o), (-0.8 + o, 0.8 - o)], stroke=RED, sw=0.1, cap="round"))
        return svg(els, vb=2.6)

    add("Schadenlage", "FW Beschaedigung", lattice([0]))
    add("Schadenlage", "FW Teilzerstoerung", lattice([-0.2, 0.2]))
    add("Schadenlage", "FW Totalzerstoerung", lattice([-0.33, 0, 0.33]))
    add("Schadenlage", "FW Ueberschwemmung", svg(
        [f'<ellipse cx="-0.25" cy="0" rx="0.72" ry="0.42" fill="none" stroke="{RED}" stroke-width="0.12"/>',
         line(0.55, 0, 1.0, 0, stroke=RED, sw=0.1),
         path([(0.95, -0.14), (1.25, 0), (0.95, 0.14)], stroke=RED, sw=0.06, fill=RED, close=True)],
        vb=2.6,
    ))

    # ── Gefahren
    # FKS Vegetationsbrand-Handbuch S. 52 — where the fire is decided: the saddle, the road,
    # the ridge it must not cross. A Schadenlage sign, not a Führung one: it describes the
    # terrain's behaviour, not a decision somebody took.
    add("Schadenlage", "FKS Schluesselstelle", svg(gear(BLUE), vb=2.6))
    add("Gefahren", "FW Gefahr Tafel", svg(
        [path([(-1.2, -0.7), (1.2, -0.7), (1.2, 0.7), (-1.2, 0.7)], stroke=ORANGE, sw=0.1, close=True),
         line(-1.2, 0, 1.2, 0, stroke=ORANGE, sw=0.1)],
        vb=3.0,
    ))
    add("Gefahren", "FW Gefahr allgemein", hazard_triangle([
        line(0, 0, 0, -0.4, stroke=ORANGE, sw=0.2, cap="round"),  # exclamation bar
        circle(0, 0.35, 0.11, stroke=ORANGE, sw=0.02, fill=ORANGE),  # …and its dot
    ]))
    add("Gefahren", "FW Gefahr Ex", hazard_triangle([text("Ex", 0.7, fill=ORANGE, y=0.2)]))
    add("Gefahren", "FW Gefahr G", hazard_triangle([text("G", 0.7, fill=ORANGE, y=0.2)]))
    add("Gefahren", "FW Gefahr C", hazard_triangle([text("C", 0.7, fill=ORANGE, y=0.2)]))
    add("Gefahren", "FW Gefahr Radioaktiv", hazard_triangle([
        circle(0, 0.2, 0.35, stroke=ORANGE, sw=0.06),
        # trefoil: three filled blades around the hub at (0, 0.2)
        path([(0, 0.2), (0.35, 0.2), (0.3, 0.38), (0.17, 0.5)], stroke=ORANGE, sw=0.06, fill=ORANGE, close=True),
        path([(0, 0.2), (-0.17, 0.5), (-0.3, 0.38), (-0.35, 0.2)], stroke=ORANGE, sw=0.06, fill=ORANGE, close=True),
        path([(0, 0.2), (-0.17, -0.1), (0, -0.15), (0.17, -0.1)], stroke=ORANGE, sw=0.06, fill=ORANGE, close=True),
    ]))
    add("Gefahren", "FW Gefahr W", hazard_triangle([
        # spray crown + crossing jets (Wasser-Gefahr / water-reactive)
        path([(-0.2, 0), (-0.1, 0.4), (0, 0.1), (0.1, 0.4), (0.2, 0)], stroke=ORANGE, sw=0.07),
        line(-0.4, 0, 0.4, 0.5, stroke=ORANGE, sw=0.06),
        line(0.4, 0, -0.4, 0.5, stroke=ORANGE, sw=0.06),
    ]))
    add("Gefahren", "FW Elektroanlage", svg(
        [path([(0.7, -1.0), (0, -0.1), (0.7, 0.5), (0.4, 1.1), (0.2, 1.0), (0.3, 1.6),
               (0.8, 1.3), (0.6, 1.2), (1.0, 0.4), (0.4, -0.1), (1.4, -0.9)],
              stroke=ORANGE, sw=0.06, fill=ORANGE, close=True)],
        viewbox="-0.9 -1.3 3.2 3.2",
    ))

    # Messpunkt (26.10.2026): where a gas reading is taken – the multigas detector the Trupp
    # holds (body, display with a trace, three sensor ports). The values are detail fields and
    # ride on the glyph as its readout (lib/symbols · symbolReadoutText); the glyph only says
    # «hier wird gemessen». All orange like the rest of the Gefahren family (27.10.): black inner
    # lines vanished in the palette and the panel header at night.
    add("Gefahren", "FW Messpunkt", svg(
        ['<rect x="-0.62" y="-1.08" width="1.24" height="2.16" rx="0.2" fill="none" '
         f'stroke="{ORANGE}" stroke-width="0.12"/>',
         '<rect x="-0.4" y="-0.82" width="0.8" height="0.62" rx="0.06" fill="none" '
         f'stroke="{ORANGE}" stroke-width="0.07"/>',
         path([(-0.28, -0.36), (-0.1, -0.56), (0.06, -0.44), (0.28, -0.68)], stroke=ORANGE, sw=0.08),
         line(-0.26, 0.08, 0.26, 0.08, stroke=ORANGE, sw=0.07)]
        + [circle(x, 0.5, 0.08, stroke=ORANGE, sw=0.02, fill=ORANGE) for x in (-0.26, 0, 0.26)],
        vb=2.6,
    ))

    # ── Führung
    add("Führung", "VKF KP Front", svg(
        [circle(0, -0.35, 0.4, stroke=BLUE, sw=0.1),
         text("F", 0.7, fill=BLUE, y=-0.35),
         line(-0.4, -0.35, -0.4, 0.64, stroke=BLUE, sw=0.1),
         circle(-0.4, 0.65, 0.08, stroke=BLUE, sw=0.1)],
        viewbox="-1.08 -1.05 2.08 2.08",
    ))
    add("Führung", "VKF Einsatzleiter", svg(
        # circle sits LOW (centre y=+0.4); the three bars hang off the pole top with clear
        # air above the circle — the "three-bar EL flag" the crews learned. Pole + top bar
        # are ONE polyline so the corner joins flush (no butt-cap notch).
        [circle(0, 0.4, 0.3, stroke=BLUE, sw=0.1),
         path([(0, 0.1), (0, -0.7), (0.4, -0.7)], stroke=BLUE, sw=0.1)]
        + [line(0, y, 0.4, y, stroke=BLUE, sw=0.1) for y in (-0.5, -0.3)],
        viewbox="-0.95 -1.0 2.0 2.0",
    ))
    add("Führung", "FW Offizier", svg(
        # pole + top bar as one polyline → flush corner (see Einsatzleiter)
        [circle(0, 0, 0.4, stroke=BLUE, sw=0.1),
         path([(0, -0.4), (0, -1.4), (0.8, -1.4)], stroke=BLUE, sw=0.1),
         line(0, -1.0, 0.8, -1.0, stroke=BLUE, sw=0.1)],
        viewbox="-1.0 -1.7 2.4 2.4",
    ))
    add("Führung", "FW Sammelplatz", holding_box("S"))
    add("Führung", "FW Warteraum", holding_box("W"))
    add("Führung", "VKF Kontrollposten", person_post([
        # the watch-eye across the post: horizontal lens spanning the full width + oval pupil
        f'<path d="M -0.4 0 A 0.65 0.65 0 0 1 0.4 0 A 0.65 0.65 0 0 1 -0.4 0 Z" fill="none" stroke="{BLUE}" stroke-width="0.07"/>',
        f'<ellipse cx="0" cy="0" rx="0.15" ry="0.1" fill="{BLUE}" stroke="{BLUE}" stroke-width="0.06"/>',
    ]))
    add("Führung", "VKF Informationszentrum", svg(
        [path([(0, -1), (1, 0), (0, 1), (-1, 0)], stroke=BLUE, sw=0.1, close=True),
         text("i", 1.2, fill=BLUE)],
        vb=2.6,
    ))
    add("Führung", "VKF Bereich Materialdepot", zone_circle("M"))
    # FKS Behelf Einsatzführung S. 37 and the Vegetationsbrand-Handbuch S. 52 both carry it —
    # so it is a general gap, not a Vegetationsbrand one. Somebody posted to watch, at the edge
    # of the Einsatz: the Rückzugsposten on a Flanke, the eye on a Brandmauer.
    add("Führung", "FKS Beobachtungsposten", svg(
        [path([(0, -0.95), (-1, 0.72), (1, 0.72)], stroke=BLUE, sw=0.1, close=True),
         text("FW", 0.6, fill=BLUE, y=0.34)],
        viewbox="-1.2 -1.2 2.4 2.4",
    ))
    add("Führung", "FW Absperrung", svg(
        # plain barrier bar with upturned ends — the unbewachte Absperrung
        # (Behelf Schadenplatz); the überwacht variant below adds the watch flags
        [path([(-0.7, 0.2), (-0.5, 0), (0.5, 0), (0.7, 0.2)], stroke=BLUE, sw=0.1)],
        viewbox="-1.1 -0.9 2.2 2.2",
    ))
    add("Führung", "VKF Verkehrssperre ueberwacht", svg(
        # barrier bar with upturned ends, a small watch flag on each
        [path([(-0.7, 0.2), (-0.5, 0), (0.5, 0), (0.7, 0.2)], stroke=BLUE, sw=0.1),
         path([(-0.8, 0.2), (-0.6, 0.2), (-0.7, 0.4)], stroke=BLUE, sw=0.06, close=True),
         path([(0.6, 0.2), (0.8, 0.2), (0.7, 0.4)], stroke=BLUE, sw=0.06, close=True)],
        viewbox="-1.1 -0.9 2.2 2.2",
    ))

    # ── Fahrzeuge / Mittel
    # same blue as the rest of the vehicle family (the FireGIS original used a darker
    # #006dff one-off; unified per corps review 2026-07-02)
    add("Fahrzeuge / Mittel", "VKF Fahrzeug", svg(vehicle_body(BLUE, 0.06), vb=2.6))
    add("Fahrzeuge / Mittel", "VKF Drehleiter", svg(
        vehicle_body(BLUE, 0.1)
        + [line(-1, -0.2, 0.4, -0.2, stroke=BLUE, sw=0.1),
           line(-1, 0.2, 0.4, 0.2, stroke=BLUE, sw=0.1)]
        + [line(x, -0.2, x, 0.2, stroke=BLUE, sw=0.1)
           for x in (-0.9, -0.7, -0.5, -0.3, -0.1, 0.1, 0.3)],
        vb=2.6,
    ))
    # Ladder-only overlay for the composite Drehleiter — the aerial ladder rendered as a
    # separately-rotatable layer over the plain vehicle body (like the Grosslüfter fan), so the
    # ladder slews independently of the truck heading. Pivots at the turntable (glyph centre 0,0)
    # and extends to one side; rotation2=0 points it back/left, matching the static thumbnail.
    # Render-only (hidden from the palette — useSymbols filters it); the palette shows the full
    # VKF Drehleiter glyph above.
    add("Fahrzeuge / Mittel", "VKF Drehleiter Leiter", svg(
        [line(0, -0.17, -1.15, -0.17, stroke=BLUE, sw=0.1),
         line(0, 0.17, -1.15, 0.17, stroke=BLUE, sw=0.1)]
        + [line(x, -0.17, x, 0.17, stroke=BLUE, sw=0.1)
           for x in (-0.15, -0.35, -0.55, -0.75, -0.95)],
        vb=2.6,
    ))
    add("Fahrzeuge / Mittel", "VKF Hubretter", svg(
        vehicle_body(BLUE, 0.1)
        + [path([(-1, 0.38), (0, 0.18), (-0.86, -0.02)], stroke=BLUE, sw=0.1)],
        vb=2.6,
    ))
    # Boom-only overlay for the composite Hubretter — the articulated Gelenkmast (two-segment boom
    # with a rescue cage at the tip) as a separately-rotatable layer over the plain body (see VKF
    # Drehleiter Leiter). The base sits at the turntable (glyph centre 0,0). Render-only (hidden from
    # the palette); the full VKF Hubretter glyph above is the palette thumbnail.
    add("Fahrzeuge / Mittel", "VKF Hubretter Arm", svg(
        [path([(0.1, 0.12), (-0.6, 0.1), (-1.05, -0.42)], stroke=BLUE, sw=0.1),
         path([(-1.22, -0.28), (-0.95, -0.62), (-0.78, -0.44)], stroke=BLUE, sw=0.1, close=True)],
        vb=2.6,
    ))
    # NOTE: the composite Grosslüfter (VKF Fahrzeug + VKF Luefter mobil) is synthesised in
    # lib/useSymbols and inserted into the palette RIGHT HERE (after the Hubretter, before the Boot)
    # — the order the crews asked for: Fahrzeug, Drehleiter, Hubretter, Grosslüfter, Boot, Pumpe, …
    # Boot / Rettungsboot — side profile, bow to the right, with a small wheelhouse (BLUE outline
    # like the other Fahrzeuge). Rotatable so the heading can be aimed on the map.
    # Redrawn from the Zivile Signaturen (01.09.). The old glyph was a side profile with a
    # wheelhouse — three shapes' worth of detail that turned to mush at 28 px and read as a
    # vehicle. The civil sign is a hull and a deck line, and it is legible at any size.
    add("Fahrzeuge / Mittel", "FW Boot", svg(
        [f'<path d="M -0.8 -0.5 L -0.8 -0.12 A 0.8 0.8 0 0 0 0.8 -0.12 L 0.8 -0.5" '
         f'fill="none" stroke="{BLUE}" stroke-width="0.11" stroke-linejoin="round"/>',
         line(-0.8, -0.12, 0.8, -0.12, stroke=BLUE, sw=0.11)],
        vb=2.6,
    ))
    add("Fahrzeuge / Mittel", "VKF Pumpe Typ2", svg(
        [path([(-1, -1), (1, -1), (1, 1), (-1, 1)], stroke=BLUE, sw=0.1, close=True),
         text("MS", 0.8, fill=BLUE, y=-0.4), text("2", 0.8, fill=BLUE, y=0.4)],
        vb=2.6,
    ))
    # ⚠️ HOUSE SYMBOLS, in the FKS grammar — not official FKS signs (11.08.).
    #
    # FireGIS was searched for both: its whole pump family is «MS 1/2/3», i.e. Motorspritzen
    # graded by type, plus a circle-and-triangle process-pump glyph used for a BUILDING's
    # Entwässerung («FW EW Pumpe», magenta). There is no sign for a Tauchpumpe and none for a
    # Wassersauger — the two devices a Wehr actually carries to a flooded cellar.
    #
    # So these follow the pack's own convention for exactly this family rather than inventing a
    # pictogram: a square in Führungs-blue with a short Kürzel, the same geometry, stroke and
    # viewBox as «MS 2» above. TP and WS read alongside MS as what they are, and a crew that
    # knows the Motorspritze sign can read them without being taught.
    add("Fahrzeuge / Mittel", "FW Tauchpumpe", svg(
        [path([(-1, -1), (1, -1), (1, 1), (-1, 1)], stroke=BLUE, sw=0.1, close=True),
         text("TP", 0.9, fill=BLUE)],
        vb=2.6,
    ))
    add("Fahrzeuge / Mittel", "FW Wassersauger", svg(
        [path([(-1, -1), (1, -1), (1, 1), (-1, 1)], stroke=BLUE, sw=0.1, close=True),
         text("WS", 0.9, fill=BLUE)],
        vb=2.6,
    ))
    # ── the smaller Mittel (after the vehicles) ──
    # Lüfter — FKS Behelf Einsatzführung, Ausbildung, S. 37 (11/2022). Corrected 2026-08-31: the
    # sign is drawn in Führungs-blau OUTLINE, not the black-on-yellow appliance pictogram this
    # pack shipped. Two open housing parts (rectangle + cone flaring towards the outflow) and an
    # airflow arrow that is a DOUBLE SHAFT with a solid head — the shaft is what tells the Lüfter
    # apart from every other blue arrow on the Lage at a glance.
    def _luefter(arrow):
        return svg(
            [path([(-0.9, -0.42), (-0.55, -0.42), (-0.55, 0.42), (-0.9, 0.42)],
                  stroke=BLUE, sw=0.1, close=True),
             path([(-0.55, -0.42), (-0.25, -0.74), (-0.25, 0.74), (-0.55, 0.42)],
                  stroke=BLUE, sw=0.1, close=True)] + arrow,
            viewbox="-1.2 -1.2 2.4 2.4",
        )

    add("Fahrzeuge / Mittel", "VKF Luefter mobil", _luefter(
        [line(-0.05, -0.17, 0.42, -0.17, stroke=BLUE, sw=0.1),
         line(-0.05, 0.17, 0.42, 0.17, stroke=BLUE, sw=0.1),
         path([(0.36, -0.5), (0.95, 0), (0.36, 0.5)], stroke=BLUE, sw=0.1, fill=BLUE, close=True)],
    ))
    # The extract/Absaugen airflow variant of the mobile Lüfter: SAME fan housing, but the airflow
    # arrow reversed to point INTO the fan (air drawn in from the right → sucked out of the space).
    # Reached only via the Lüfter's Luftrichtung toggle (SymbolProps.extract) — NOT a separate palette
    # entry: useSymbols keeps it in `byName` for rendering but filters it out of the picker. The arrow
    # is the base arrow reflected about its own centre (x'=0.9-x), so it stays in the same box.
    add("Fahrzeuge / Mittel", "VKF Luefter mobil saugend", _luefter(
        [line(0.95, -0.17, 0.48, -0.17, stroke=BLUE, sw=0.1),
         line(0.95, 0.17, 0.48, 0.17, stroke=BLUE, sw=0.1),
         path([(0.54, -0.5), (-0.05, 0), (0.54, 0.5)], stroke=BLUE, sw=0.1, fill=BLUE, close=True)],
    ))
    add("Fahrzeuge / Mittel", "FW Kleinloeschgeraet", svg(
        [path([(-0.3, 0.6), (0, -0.4), (0.3, 0.6)], stroke=BLUE, sw=0.1, close=True)],
        viewbox="-0.8 -0.7 1.6 1.6",
    ))
    # Drohne — FKS Vegetationsbrand-Handbuch S. 52. Replaced our own top-down quadcopter on
    # 01.09.: that glyph was authored on the belief that FKS had no drone sign, and it does —
    # the swept chevron, which is also what the Landeplatz below frames. Four rotor rings at
    # 28 px were a smudge anyway, where this reads as one shape.
    add("Fahrzeuge / Mittel", "VKF Drohne", svg(
        [path([(-0.95, -0.5), (0, 0.56), (0.95, -0.5), (0.7, -0.5), (0, 0.22), (-0.7, -0.5)],
              stroke=BLUE, sw=0.09, close=True)],
        vb=2.6,
    ))
    # …and the mirror of the Drohne right above: we could place the machine but not where it
    # goes up and down. Same box-with-content grammar as VKF Helilandeplatz. (Machine before
    # its Landeplatz, both pairs — the picker reads Drohne → Landeplatz, Heli → Landeplatz.)
    add("Fahrzeuge / Mittel", "FKS Drohnenlandeplatz", svg(
        [path([(-1, -0.62), (1, -0.62), (1, 0.62), (-1, 0.62)], stroke=BLUE, sw=0.1, close=True),
         path([(-0.9, -0.5), (0, 0.54), (0.9, -0.5), (0.66, -0.5), (0, 0.2), (-0.66, -0.5)],
              stroke=BLUE, sw=0.09, close=True)],
        vb=2.6,
    ))
    # Helikopter — FKS Vegetationsbrand S. 52. The lying eight is the rotor disc seen from
    # above; we had the Helilandeplatz but no sign for the machine itself, which left the
    # landing site standing there alone.
    add("Fahrzeuge / Mittel", "FKS Helikopter", svg(
        [f'<path d="M -0.95 0 C -0.95 -0.5 -0.3 -0.5 0 0 C 0.3 0.5 0.95 0.5 0.95 0 '
         f'C 0.95 -0.5 0.3 -0.5 0 0 C -0.3 0.5 -0.95 0.5 -0.95 0 Z" '
         f'fill="none" stroke="{BLUE}" stroke-width="0.09" stroke-linejoin="round"/>'],
        vb=2.6,
    ))
    add("Fahrzeuge / Mittel", "VKF Helilandeplatz", svg(
        [path([(-1, -1), (1, -1), (1, 1), (-1, 1)], stroke=BLUE, sw=0.1, close=True),
         line(-1, 0, 1, 0, stroke=BLUE, sw=0.1),
         # rope-knot (lying eight) in the top half: centre cross + two side loops
         line(0, -0.5, -0.2, -0.4, stroke=BLUE, sw=0.1),
         line(0, -0.5, 0.2, -0.6, stroke=BLUE, sw=0.1),
         line(0, -0.5, 0.2, -0.4, stroke=BLUE, sw=0.1),
         line(0, -0.5, -0.2, -0.6, stroke=BLUE, sw=0.1),
         f'<path d="M -0.2 -0.6 L -0.4 -0.7 A 0.21 0.21 0 0 0 -0.7 -0.5 A 0.23 0.23 0 0 0 -0.4 -0.3 A 0.81 0.81 0 0 0 -0.2 -0.4" fill="none" stroke="{BLUE}" stroke-width="0.1" stroke-linejoin="round"/>',
         f'<path d="M 0.2 -0.6 L 0.4 -0.7 A 0.21 0.21 0 0 1 0.7 -0.5 A 0.23 0.23 0 0 1 0.4 -0.3 A 0.81 0.81 0 0 1 0.2 -0.4" fill="none" stroke="{BLUE}" stroke-width="0.1" stroke-linejoin="round"/>'],
        vb=2.6,
    ))
    # Zivile Signaturen S. 7 — the Bereitstellungsraum for VEHICLES. We had Sammelplatz and
    # Warteraum for people and nothing at all for where the Fahrzeuge are parked.
    add("Fahrzeuge / Mittel", "ZS Fahrzeugplatz", svg(
        [path([(-1, -0.62), (1, -0.62), (1, 0.62), (-1, 0.62)], stroke=BLUE, sw=0.1, close=True),
         text("Fz", 0.8, fill=BLUE)],
        vb=2.6,
    ))
    add("Fahrzeuge / Mittel", "FW Entrauchung", svg(
        [path([(-0.5, 0.4), (0.5, 0.4), (-0.5, -0.6)], stroke=BLUE, sw=0.1, fill=BLUE, close=True),
         path([(-0.5, -0.6), (0.5, -0.6), (0.5, 0.4), (-0.5, 0.4)], stroke=BLUE, sw=0.1, close=True),
         line(-0.1, -0.8, -0.1, -1.4, stroke=BLUE, sw=0.1),
         line(0.1, -0.8, 0.1, -1.4, stroke=BLUE, sw=0.1),
         path([(-0.2, -1.4), (0.2, -1.4), (0, -1.9)], stroke=BLUE, sw=0.1, close=True)],
        viewbox="-1.45 -2.2 2.9 2.9",
    ))
    add("Fahrzeuge / Mittel", "FW Sprungretter", svg(
        [path([(-1, -1), (1, -1), (1, 1), (-1, 1)], stroke=BLUE, sw=0.1, close=True)]
        + [line(x, y, x / 2, y / 2, stroke=BLUE, sw=0.1)
           for x, y in ((1, -1), (-1, 1), (-1, -1), (1, 1))],
        vb=2.6,
    ))
    add("Fahrzeuge / Mittel", "FW Leiter", svg(
        # two stiles with rounded tips + rungs (top/bottom rungs sit inset from the tips)
        [line(x, -0.8, x, 0.8, stroke=BLUE, sw=0.1, cap="round") for x in (-0.4, 0.4)]
        + [line(-0.4, y, 0.4, y, stroke=BLUE, sw=0.1)
           for y in (-0.7, -0.5, -0.3, -0.1, 0.1, 0.3, 0.5, 0.7)],
        viewbox="-1.1 -1.1 2.2 2.2",
    ))

    # ── Personen / Sanität
    add("Personen / Sanität", "VKF Sammelstelle", person_post([
        line(-0.4, -0.06, 0.4, -0.06, stroke=BLUE, sw=0.07),
        line(-0.4, 0.06, 0.4, 0.06, stroke=BLUE, sw=0.07),
    ]))
    add("Personen / Sanität", "VKF Patientensammelstelle", person_post([
        line(-0.4, 0, 0.4, 0, stroke=BLUE, sw=0.07),
        line(0, -1, 0, 1, stroke=BLUE, sw=0.07),
    ]))
    add("Personen / Sanität", "VKF Sanitaetshilfsstelle", person_post([
        line(-0.4, -0.06, 0.4, -0.06, stroke=BLUE, sw=0.07),
        line(-0.4, 0.06, 0.4, 0.06, stroke=BLUE, sw=0.07),
        line(0, -1, 0, 1, stroke=BLUE, sw=0.07),
    ]))
    add("Personen / Sanität", "VKF Totensammelstelle", person_post([
        line(-0.28, -0.4, 0.28, -0.4, stroke=BLUE, sw=0.07),
        line(0, -0.72, 0, 0.7, stroke=BLUE, sw=0.07),
    ]))
    add("Personen / Sanität", "FW Verwundetennest", svg(
        [path([(-1, -1.4), (1, -1.4), (1, 1.4), (-1, 1.4)], stroke=BLUE, sw=0.1, close=True),
         line(0, -1.4, 0, 1.4, stroke=BLUE, sw=0.1),
         line(-1, 0, 1, 0, stroke=BLUE, sw=0.1)],
        viewbox="-1.7 -1.7 3.4 3.4",
    ))
    # ── Zivile Signaturen S. 7, drawn as the sheet draws them (decision 01.09.) ──
    # Faithful rather than in our own Rechteck-plus-Kürzel house form: these are exactly the
    # signs the partners we share a Lagekarte with — Zivilschutz, Gemeindeführungsorgan — read
    # without being taught, and that is the whole reason to adopt them at all.
    #
    # Angehörige: the face over the question mark. Not the Patienten and not the Toten — the
    # people asking after them, who need a place to be sent that nobody has to improvise.
    add("Personen / Sanität", "ZS Angehoerigensammelstelle", person_post([
        line(-0.4, 0, 0.4, 0, stroke=BLUE, sw=0.07),
        circle(0, -0.5, 0.24, stroke=BLUE, sw=0.07),
        circle(-0.09, -0.57, 0.045, stroke=BLUE, sw=0.02, fill=BLUE),
        circle(0.09, -0.57, 0.045, stroke=BLUE, sw=0.02, fill=BLUE),
        f'<path d="M -0.1 -0.38 A 0.14 0.14 0 0 1 0.1 -0.38" fill="none" stroke="{BLUE}" stroke-width="0.06"/>',
        text("?", 0.62, fill=BLUE, y=0.5),
    ]))
    # Verpflegung and Betriebsstoff: the two things an Einsatz needs once it stops being short.
    add("Personen / Sanität", "ZS Verpflegungsabgabestelle", person_post([
        line(0.12, -1, 0.12, 1, stroke=BLUE, sw=0.07),
    ]))
    add("Personen / Sanität", "ZS Betriebsstoffabgabestelle", person_post([
        path([(-0.25, -0.34), (0.25, -0.34), (0, 0.08)], stroke=BLUE, sw=0.08, close=True),
        line(0, 0.08, 0, 0.62, stroke=BLUE, sw=0.08),
    ]))
    # Dekontaminationsstelle: we could mark the Bereich Chemiewehr but not the one place
    # everybody coming out of it has to pass through.
    add("Personen / Sanität", "ZS Dekontaminationsstelle", svg(
        [circle(0, 0, 1, stroke=BLUE, sw=0.09),
         circle(-0.42, -0.46, 0.1, stroke=BLUE, sw=0.02, fill=BLUE),
         circle(0.42, -0.46, 0.1, stroke=BLUE, sw=0.02, fill=BLUE),
         f'<path d="M -0.42 -0.46 Q -0.1 -0.1 0.34 0.16" fill="none" stroke="{BLUE}" stroke-width="0.08"/>',
         f'<path d="M 0.42 -0.46 Q 0.1 -0.1 -0.34 0.16" fill="none" stroke="{BLUE}" stroke-width="0.08"/>',
         text("DECON", 0.34, fill=BLUE, y=0.6)],
        vb=2.6,
    ))
    add("Personen / Sanität", "VKF Bereich Sanitaet", zone_circle("SAN"))
    # AED / Defibrillator wall placard — same field report as GB BMA-Z above; the green plate
    # every Einsatzplan legend already prints next to a first-aid point.
    add("Personen / Sanität", "FW AED", placard("AED", GREEN, w=0.85, fs=0.68))

    # ── Partner
    add("Partner", "VKF Bereich Feuerwehr", zone_circle("FW"))
    add("Partner", "VKF Bereich Polizei", zone_circle("P"))
    add("Partner", "VKF Bereich Chemiewehr", zone_circle("CW"))
    add("Partner", "VKF Bereich Zivilschutz", zone_circle("ZS"))
    # FKS Vegetationsbrand S. 52 — the Forstdienst, in the same open-circle grammar as the
    # four Bereiche above it. At a Waldbrand they are the people who know the ground.
    add("Partner", "FKS Forst", svg(
        [circle(0, 0, 1, stroke=BLUE, sw=0.1), text("FORST", 0.46, fill=BLUE)], vb=2.6,
    ))

    # ── Wasser
    add("Wasser", "SI Ueberflurhydrant", svg(
        [circle(0, 0, 0.6, stroke=BLACK, sw=0.06),
         circle(0, 0, 0.2, stroke=BLACK, sw=0.06, fill=BLACK)],
        vb=1.8,
    ))
    add("Wasser", "SI Unterflurhydrant", svg([circle(0, 0, 0.6, stroke=BLACK, sw=0.06)], vb=1.8))
    add("Wasser", "VKF Innenhydrant", svg(
        [path([(-1, -0.5), (1, -0.5), (1, 0.5), (-1, 0.5)], stroke="#0032cc", sw=0.06, close=True),
         circle(0, 0, 0.5, stroke="#0032cc", sw=0.06, fill="#0032cc")],
        vb=2.6,
    ))
    add("Wasser", "SI Wasserloeschposten", svg(
        [path([(-0.9, -0.6), (0.9, -0.6), (0.9, 0.6), (-0.9, 0.6)], stroke=BLACK, sw=0.06, close=True),
         circle(0, 0, 0.6, stroke=BLACK, sw=0.06),
         # left half of the disc filled
         f'<path d="M 0 0.6 A 0.6 0.6 0 0 1 0 -0.6 L 0 0.6 Z" fill="{BLACK}" stroke="{BLACK}" stroke-width="0.06"/>'],
        vb=2.4,
    ))
    add("Wasser", "WV Loeschweier", svg(basin("#0080ff", 0.1), viewbox="-1.15 -1.05 2.3 2.3"))
    add("Wasser", "SI Wasserbezugsort", svg(basin(BLACK, 0.1), viewbox="-1.15 -1.05 2.3 2.3"))
    add("Wasser", "SI Wasserdruckversorgung", svg(
        [circle(0, 0, 1, stroke=BLACK, sw=0.03),
         line(-1, 0, 1, 0, stroke=BLACK, sw=0.03),
         line(0, 0, 0, 1, stroke=BLACK, sw=0.03)],
        vb=2.3,
    ))

    # ── Gebäude
    # fire-resistance walls: the tick count encodes the rating (1=F30, 2=F60, 3=F180)
    add("Gebäude", "GB BA Wand F30", svg(
        [line(-0.6, 0, 0.6, 0, stroke=BLACK, sw=0.1), line(0, -0.3, 0, 0.3, stroke=BLACK, sw=0.06)],
        vb=1.8,
    ))
    add("Gebäude", "GB BA Wand F60", svg(
        [line(-0.6, 0, 0.6, 0, stroke=BLACK, sw=0.1)]
        + [line(x, -0.3, x, 0.3, stroke=BLACK, sw=0.06) for x in (-0.1, 0.1)],
        vb=1.8,
    ))
    add("Gebäude", "GB BA Wand F180", svg(
        [line(-0.6, 0, 0.6, 0, stroke=BLACK, sw=0.1)]
        + [line(x, -0.3, x, 0.3, stroke=BLACK, sw=0.06) for x in (-0.2, 0, 0.2)],
        vb=1.8,
    ))

    def door(extra, viewbox="-0.9 -0.9 1.8 1.8"):
        # grey wall band + black leaf line with jamb ticks
        return svg(
            [path([(-0.6, 0.1), (0.6, 0.1), (0.6, -0.1), (-0.6, -0.1)], stroke="#bbbbbb", sw=0.06, close=True),
             line(-0.6, 0, 0.6, 0, stroke=BLACK, sw=0.06),
             line(-0.6, -0.3, -0.6, 0.3, stroke=BLACK, sw=0.06),
             line(0.6, -0.3, 0.6, 0.3, stroke=BLACK, sw=0.06)] + extra,
            viewbox=viewbox,
        )

    add("Gebäude", "GB Ture BS R30", door(
        [text("R30", 0.4, y=-0.3)], viewbox="-0.9 -1.0 1.8 1.8"))
    add("Gebäude", "GB Ture Durchgang", door([]))
    add("Gebäude", "GB Lift", svg(
        [path([(-1, -1), (1, -1), (1, 1), (-1, 1)], stroke=BLACK, sw=0.06, close=True),
         line(-1, -1, 1, 1, stroke=BLACK, sw=0.06),
         line(1, -1, -1, 1, stroke=BLACK, sw=0.06)],
        vb=2.6,
    ))

    def half_square(extra, viewbox="-0.9 -0.9 1.8 1.8"):
        # square with the lower-left half filled (Kamin / Abzug family)
        return svg(
            [path([(-0.6, 0.6), (0.6, 0.6), (-0.6, -0.6)], stroke=BLACK, sw=0.06, fill=BLACK, close=True),
             path([(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)], stroke=BLACK, sw=0.06, close=True)]
            + extra,
            viewbox=viewbox,
        )

    add("Gebäude", "GB Kamin", half_square([]))
    add("Gebäude", "GB Abzug", half_square([text("RWA", 0.4, y=0.9)], viewbox="-1.15 -0.9 2.3 2.3"))
    add("Gebäude", "SI Schieber", svg(
        [path([(0, 0), (-0.25, -0.35), (0.25, -0.35)], stroke=BLACK, sw=0.06, fill=BLACK, close=True),
         path([(0, 0), (-0.25, 0.35), (0.25, 0.35)], stroke=BLACK, sw=0.06, fill=BLACK, close=True)],
        vb=1.3,
    ))
    add("Gebäude", "GB Elektrotableau", svg(
        [path([(-1.5, -0.5), (1.5, -0.5), (1.5, 0.5), (-1.5, 0.5)], stroke=BLACK, sw=0.06, close=True),
         path([(-1.1, 0.3), (0, -0.3), (-0.2, 0.3), (0.7, 0)], stroke=BLACK, sw=0.1, fill=BLACK, close=True),
         path([(0.6, -0.2), (0.8, 0.3), (1.1, -0.1)], stroke=BLACK, sw=0.1, fill=BLACK, close=True)],
        vb=3.6,
    ))
    add("Gebäude", "GB Sprinklerzentrale", svg(
        [path([(0, 0), (-0.7, 0.5), (-0.7, -0.5)], stroke=BLACK, sw=0.06, fill=BLACK, close=True),
         path([(0, 0), (0.7, 0.5), (0.7, -0.5)], stroke=BLACK, sw=0.06, fill=BLACK, close=True),
         circle(0.7, 0.6, 0.1, stroke=BLACK, sw=0.06),
         circle(-0.7, -0.6, 0.1, stroke=BLACK, sw=0.06)],
        vb=2.2,
    ))
    add("Gebäude", "GB Brandmeldezentrale", svg(
        [path([(-0.9, -0.6), (0.9, -0.6), (0.9, 0.6), (-0.9, 0.6)], stroke=BLACK, sw=0.06, close=True),
         circle(-0.6, 0.3, 0.15, stroke=BLACK, sw=0.06, fill=BLACK),
         line(-0.6, -0.4, -0.6, 0, stroke=BLACK, sw=0.1)],
        vb=2.4,
    ))
    add("Gebäude", "GB BMA Melder", svg(
        # single detector as drawn on the BMA-Anlageplan: circle with a RED centre dot —
        # marks the Melder that tripped / where the crew went to check
        [circle(0, 0, 0.75, stroke=BLACK, sw=0.06),
         circle(0, 0, 0.16, stroke=RED, sw=0.06, fill=RED)],
        vb=2.0,
    ))
    # Wand-Piktogramme, added 02.09. after a field report: a reproduced Einsatzplan-Legende
    # (BMA-Z/RWA-BS placards) had no matching symbols, so a crew could not dock a hose line to
    # them — only kind:'symbol' annotations are magnetic (lib/hoseSnap; deliberately untouched).
    # These are the actual placards screwed to the wall next to `GB Brandmeldezentrale` /
    # `GB Abzug` (the schematic anlage icons above) — not a duplicate, a different object: the
    # sign that tells an arriving crew where the panel/valve/connection IS, in the exact red/
    # yellow plate-plus-Kürzel grammar every Swiss Einsatzplan legend already prints.
    add("Gebäude", "GB BMA-Z", placard("BMA-Z", RED, w=1.05, fs=0.58))
    add("Gebäude", "GB RWA-BS", placard("RWA-BS", YELLOW, w=1.25, fs=0.5))
    add("Gebäude", "GB Fernsignaltableau", svg(
        [path([(-0.9, -0.6), (0.9, -0.6), (0.9, 0.6), (-0.9, 0.6)], stroke=BLACK, sw=0.06, close=True),
         circle(-0.4, 0, 0.3, stroke=BLACK, sw=0.06),
         line(-0.6, -0.2, -0.2, 0.2, stroke=BLACK, sw=0.06),
         line(-0.2, -0.2, -0.6, 0.2, stroke=BLACK, sw=0.06)],
        vb=2.4,
    ))
    add("Gebäude", "GB Schluesseldepot", svg(
        [path([(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)], stroke=BLACK, sw=0.06, close=True),
         circle(0, -0.3, 0.16, stroke=BLACK, sw=0.06),
         path([(0, -0.14), (0, 0.4), (0.3, 0.4)], stroke=BLACK, sw=0.06),
         line(0.2, 0.2, 0, 0.2, stroke=BLACK, sw=0.06)],
        vb=1.8,
    ))
    add("Gebäude", "GB Treppe 8", svg(
        # closed outer border (flush corners) + 7 inner treads + up-arrow centre line
        [path([(0, 0), (0.8, 0), (0.8, 1.6), (0, 1.6)], stroke=BLACK, sw=0.06, close=True)]
        + [line(0, y, 0.8, y, stroke=BLACK, sw=0.06) for y in (0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4)]
        + [line(0.4, 1.6, 0.4, 0.4, stroke=BLACK, sw=0.06),
           path([(0.4, 0), (0.2, 0.4), (0.6, 0.4)], stroke=BLACK, sw=0.06, fill=BLACK, close=True)],
        viewbox="-0.7 -0.3 2.2 2.2",
    ))

    # ── Karte
    add("Karte", "SI Windrichtung", svg(
        [path([(0, 1.25), (0.05, 1.25), (0.05, -0.95), (0.35, -0.95), (0, -1.55),
               (-0.3, -0.95), (-0.05, -0.95), (-0.05, 1.25)],
              stroke=BLACK, sw=0.06, fill=BLACK, close=True),
         path([(-0.3, 1.2), (-0.3, 1.3), (0.3, 1.3), (0.3, 1.2)],
              stroke=BLACK, sw=0.06, fill=BLACK, close=True)],
        viewbox="-1.7 -1.85 3.45 3.45",
    ))
    add("Karte", "SI Nordpfeil", svg(
        [path([(-0.4, 0.7), (-0.4, -0.4), (0.4, 0.7), (0.5, 0.7), (0.5, -0.5), (0.4, -0.5),
               (0.4, 0.57), (-0.35, -0.5), (-0.5, -0.5), (-0.5, 0.7)],
              stroke=BLACK, sw=0.06, fill=BLACK, close=True),
         path([(0, 1.25), (0.05, 1.25), (0.05, -0.95), (0.35, -0.95), (0, -1.55),
               (-0.3, -0.95), (-0.05, -0.95), (-0.05, 1.25)],
              stroke=BLACK, sw=0.06, fill=BLACK, close=True)],
        viewbox="-1.7 -1.85 3.4 3.4",
    ))

    return [{"cat": c, "name": n, "svg": s} for c, n, s in syms]


# palette section order (owner pick 05.11.2026); the Palette inserts «Formen» right after
# Gefahren (Palette · FORMEN_AFTER_CAT), so the sheet reads … Gefahren · Formen · Wasser …
ORDER = ["Schadenlage", "Fahrzeuge / Mittel", "Führung", "Personen / Sanität", "Partner",
         "Gefahren", "Wasser", "Gebäude", "Karte"]


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "review"
    # compare against the historical FireGIS pack when it still exists (pre-swap trees);
    # afterwards the review page simply shows the authored pack alone.
    old_file = ROOT / "public/firegis-symbols.json"
    old_by = ({s["name"]: s["svg"] for s in json.loads(old_file.read_text())["symbols"]}
              if old_file.exists() else {})
    new = build()

    if mode == "emit":
        # every loader reads the known keys (order/symbols), so the marker rides along harmlessly
        out = {
            "_generated": "Do not edit — generated by tools/gen_symbols.py; "
                          "run: python3 tools/gen_symbols.py emit",
            "order": ORDER, "symbols": new,
        }
        (ROOT / "public/tactical-symbols.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
        print(f"wrote public/tactical-symbols.json ({len(new)} symbols)")
        return

    # review page: old (FireGIS) vs new (ours) side by side, on light AND dark strips
    rows = []
    for s in new:
        o = old_by.get(s["name"], "<i>–</i>")
        rows.append(
            f'<tr><td class="n">{s["cat"]}<br><b>{s["name"]}</b></td>'
            f'<td class="g">{o}</td><td class="g">{s["svg"]}</td>'
            f'<td class="g dark">{o}</td><td class="g dark">{s["svg"]}</td></tr>'
        )
    page = (
        '<!doctype html><meta charset="utf-8"><title>Symbol review — alt vs. neu</title>'
        "<style>body{font:13px sans-serif;margin:16px}table{border-collapse:collapse}"
        "td,th{border:1px solid #ccc;padding:6px;text-align:center}"
        ".g svg{width:72px;height:72px}.g{background:#f2efe9}.g.dark{background:#20262e}"
        ".n{text-align:left;min-width:180px}</style>"
        "<h2>Symbol pack review — FireGIS (alt) vs. KP Front (neu)</h2>"
        "<table><tr><th>Symbol</th><th>alt · hell</th><th>NEU · hell</th>"
        "<th>alt · dunkel</th><th>NEU · dunkel</th></tr>" + "".join(rows) + "</table>"
    )
    (ROOT / "tools/symbols-review.html").write_text(page)
    print(f"wrote tools/symbols-review.html ({len(new)} symbols)")


if __name__ == "__main__":
    main()
