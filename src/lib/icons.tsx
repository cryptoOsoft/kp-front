// Minimal inline line-icon set for UI chrome (NOT tactical symbols — those come from FireGIS).
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <symbol id="cursor" viewBox="0 0 24 24"><path d="M5 3l15 6.5-6.5 2.2L11 21z" /></symbol>
      <symbol id="hex" viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21 4 16.5v-9z" /></symbol>
      <symbol id="pen" viewBox="0 0 24 24"><path d="M4 20l3.5-1 11-11-2.5-2.5L5 16.5z" /><path d="M14 6.5 17.5 10" /></symbol>
      {/* The Tafel (23.10.2026, sweep G.9): a board on two legs, empty. It wore #pen, which is
          «Linie» in the tool rail right beside it – one glyph, two tools, with rail words off. */}
      <symbol id="easel" viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="11.5" rx="1.2" /><path d="M8.2 21 10 15M15.8 21 14 15M12 3.5V2" /></symbol>
      <symbol id="area" viewBox="0 0 24 24"><path d="M5 7l7-3 7 4-2 9-9 2z" /></symbol>
      <symbol id="circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="1.3" /></symbol>
      <symbol id="type" viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M9 19h6" /></symbol>
      <symbol id="people" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5.2a3 3 0 0 1 0 5.8M21 20c0-2.6-1.6-4.5-4.2-5.1" /></symbol>
      <symbol id="mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></symbol>
      <symbol id="cam" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.4" /><path d="M8 7l1.5-3h5L16 7" /></symbol>
      <symbol id="eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></symbol>
      <symbol id="eyeoff" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.2A9.5 9.5 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3.3 3.8M6.4 7.7A15.7 15.7 0 0 0 2 12s3.5 6 10 6a9.4 9.4 0 0 0 3.2-.6" /></symbol>
      <symbol id="layers" viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5z" /><path d="M3 13l9 5 9-5" /></symbol>
      <symbol id="floors" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></symbol>
      <symbol id="plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="minus" viewBox="0 0 24 24"><path d="M5 12h14" /></symbol>
      <symbol id="cross" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></symbol>
      <symbol id="locate" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" /><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></symbol>
      {/* Zeitraum on the Zeitplan is a ZOOM: «−» widens the window, so the hour count beside it
          goes UP. A bare −/+ next to a number promises the opposite, which is why these carry
          the magnifier. */}
      <symbol id="zoom-out" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.4 15.4 21 21M7.5 10.5h6" /></symbol>
      <symbol id="zoom-in" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.4 15.4 21 21M7.5 10.5h6M10.5 7.5v6" /></symbol>
      <symbol id="coords" viewBox="0 0 24 24"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" /><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" /></symbol>
      <symbol id="sat" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18" /></symbol>
      <symbol id="map" viewBox="0 0 24 24"><path d="M9 4 3 6.5v14L9 18l6 2.5 6-2.5v-14L15 6.5z" /><path d="M9 4v14M15 6.5v14" /></symbol>
      {/* «Eintrag» (29.09.2026, sweep K2): writing lines and a pencil on them — a Verlauf entry
          being written. It was the bare «+», 60px above the tool bar's «+ Hinzufügen», so one
          glyph meant «put on the map» AND «write in the Verlauf». «+» is Hinzufügen only now.
          The FAB and the top bar draw it INLINE (EntryGlyph below), never through this sprite
          symbol — see the ⚠️ in FabEntry; this one serves everyone else. */}
      <symbol id="entry" viewBox="0 0 24 24"><path d={ENTRY_PATH} /></symbol>
      <symbol id="doc" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12.5h6M9 16h6" /></symbol>
      {/* Rapportangaben: the Erfassungsblatt on its board. `journalArea` classifies a row as
          Bereich «Rapport» by this icon (lib/report.ts), and both writers — the preflight and
          the QR poster (lib/captureClient) — emit it, so the symbol has to exist or the row
          draws an empty disc. Line positions match #doc so the two read as siblings. */}
      <symbol id="clipboard" viewBox="0 0 24 24"><path d="M9 4.5H7a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-2" /><rect x="9" y="3" width="6" height="3.5" rx="1" /><path d="M9 12.5h6M9 16h6" /></symbol>
      {/* Beilage am Rapport — a paperclip, and its own glyph on purpose. The QR poster's
          «Beilage hinzugefügt» rows used to wear #photo, the same glyph a composer photo entry
          wears; on the Verlauf the disc is now the whole classification, so one glyph meaning
          both «Rapport» and «Manuell» is a disc that cannot be read. `journalArea` still reads
          the old #photo rows as Rapport — the record is append-only (lib/report.ts). */}
      <symbol id="attach" viewBox="0 0 24 24"><path d="M20.6 11.4 12 20a5.6 5.6 0 0 1-7.9-7.9l8.6-8.6a3.7 3.7 0 0 1 5.3 5.3l-8.6 8.6a1.9 1.9 0 0 1-2.6-2.6l7.9-7.9" /></symbol>
      {/* «Angedockt» on a Trupp marker (15.09.): two links of a chain, and NOT the #attach
          paperclip above, which means «Beilage am Rapport». The Atemschutz card spells the bond
          out as «bei «Hydrant»»; the map pill has no room for a second name beside the one it
          already carries, so on the Karte the glyph alone says «dieser Trupp hängt an etwas». */}
      <symbol id="unlink" viewBox="0 0 24 24"><path d="M10.3 13.7a4.2 4.2 0 0 0 6 0l2.8-2.8a4.2 4.2 0 0 0-6-6l-1.6 1.6" /><path d="M13.7 10.3a4.2 4.2 0 0 0-6 0l-2.8 2.8a4.2 4.2 0 0 0 6 6l1.6-1.6" /><path d="M4 4l16 16" /></symbol>
      <symbol id="link" viewBox="0 0 24 24"><path d="M10.3 13.7a4.2 4.2 0 0 0 6 0l2.8-2.8a4.2 4.2 0 0 0-6-6l-1.6 1.6" /><path d="M13.7 10.3a4.2 4.2 0 0 0-6 0l-2.8 2.8a4.2 4.2 0 0 0 6 6l1.6-1.6" /></symbol>
      {/* «An Stationsdrucker»: paper going in at the top, paper coming out at the bottom. The
          relay buttons carried a bare status dot and no glyph at all, so they read as a stray
          label beside every sibling action that HAS one. The dot stays — it says whether the
          agent in the Magazin is reachable, which the printer itself cannot say. */}
      <symbol id="printer" viewBox="0 0 24 24"><path d="M7 9V3.5h10V9" /><path d="M7 17.5H5a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2h-2" /><path d="M7 14.5h10v6H7z" /></symbol>
      <symbol id="truck" viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" /><circle cx="7" cy="18" r="1.7" /><circle cx="17" cy="18" r="1.7" /></symbol>
      <symbol id="box" viewBox="0 0 24 24"><path d="M12 3 4 7v10l8 4 8-4V7z" /><path d="M4 7l8 4 8-4M12 11v10" /></symbol>
      <symbol id="warn" viewBox="0 0 24 24"><path d="M12 3.5 22 20.5H2z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.7" r=".4" /></symbol>
      <symbol id="drop" viewBox="0 0 24 24"><path d="M12 3.5c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" /></symbol>
      {/* The Manometer (26.09.2026, phone card slim-down): a half dial with its needle — what an
          Atemschutzgeräteträger reads the pressure off, and it means pressure and nothing else. It
          replaced the #drop on the pressure tile and on the top bar's Alarmdruck chip: a droplet
          says WATER, which is the one thing a bar reading under Atemschutz is not. #drop stays for
          the Leitung rows of the Verlauf (useTruppActions), where water is what it means. Distinct
          from #gauge (a full dial with its stem, the Atemschutz surface's own glyph) at 16px by the
          open bottom. */}
      <symbol id="manometer" viewBox="0 0 24 24"><path d="M4 16.5a8 8 0 0 1 16 0" /><path d="M12 16.5 16.6 11.3" /><circle cx="12" cy="16.5" r="1.3" fill="currentColor" stroke="none" /><path d="M12 8.5V10M6.2 12.4l1.3.7M17.8 12.4l-1.3.7" stroke-opacity=".55" /></symbol>
      <symbol id="radio" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a9 9 0 0 0 0 12M18 6a9 9 0 0 1 0 12" /></symbol>
      <symbol id="flag" viewBox="0 0 24 24"><path d="M6 3v18M6 4h11l-2.5 3.5L17 11H6" /></symbol>
      <symbol id="arrow" viewBox="0 0 24 24"><path d="M4 12h14M13 6l6 6-6 6" /></symbol>
      <symbol id="photo" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M3 17l5-4 4 3 3-2 6 5" /></symbol>
      <symbol id="snapshot" viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4M5 19h14" /></symbol>
      <symbol id="upload" viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 19h14" /></symbol>
      {/* arrow INTO a tray — «speichern», distinct from `snapshot`, whose bare arrow means «take one» */}
      <symbol id="download" viewBox="0 0 24 24"><path d="M12 3.5v10M8 10l4 4 4-4M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3" /></symbol>
      <symbol id="wave" viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></symbol>
      <symbol id="sparkle" viewBox="0 0 24 24"><path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" /></symbol>
      <symbol id="skip-back-15" viewBox="0 0 24 24"><path d="M11 6 5 12l6 6M19 6l-6 6 6 6" /></symbol>
      <symbol id="skip-fwd-15" viewBox="0 0 24 24"><path d="M13 6l6 6-6 6M5 6l6 6-6 6" /></symbol>
      {/* a funnel: the rank quick-filter, where a row of chips costs a phone a whole band */}
      <symbol id="filter" viewBox="0 0 24 24"><path d="M3.5 5h17l-6.5 7.5V20l-4-2.2v-5.3z" /></symbol>
      {/* «Trupp finden» (29.09.2026, sweep 3 T8): the Trupp tool's own flag inside a finder's
          reticle — «where is that Trupp». It wore the #search lens, which the Suche's tile wears
          60px below it on a phone: one glyph, two searches, and a gloved thumb picking the wrong
          one. Distinct from #locate (a dot, «me») by the flag. Wherever «Trupp finden» appears. */}
      <symbol id="trupp-find" viewBox="0 0 24 24"><circle cx="8" cy="7.5" r="3" /><path d="M2.5 19c0-3.2 2.4-5.3 5.5-5.3 1.4 0 2.6.4 3.6 1.1" /><circle cx="16.5" cy="15.5" r="3.6" /><path d="M19.1 18.1 22 21" /></symbol>
      <symbol id="search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M16 16l5 5" /></symbol>
      <symbol id="close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></symbol>
      <symbol id="info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.7" r=".5" /></symbol>
      <symbol id="mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6.5L20.5 7" /></symbol>
      <symbol id="copy" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M15 5H5a2 2 0 0 0-2 2v10" /></symbol>
      {/* The drawer toggle (/admin on a phone, UI sweep 07.10.2026). It wore #layers, which is
          «Kartenebenen» one entry down the very drawer it opens. Three bars = «sections». */}
      <symbol id="menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></symbol>
      <symbol id="more-vert" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" /></symbol>
      {/* …lying down: the last chip of the phone card's fact strip (26.09.2026, phone card
          slim-down) — a horizontal ⋯ reads as «more of this row», the vertical one as a head's menu */}
      <symbol id="more" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" /></symbol>
      <symbol id="compass" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 4.5 14.5 13 12 11 9.5 13z" fill="var(--red)" stroke="none" /><path d="M12 13v6" stroke-opacity=".4" /></symbol>
      <symbol id="undo" viewBox="0 0 24 24"><path d="M9 7 4 12l5 5" /><path d="M4 12h11a5 5 0 0 1 0 10h-2" /></symbol>
      <symbol id="redo" viewBox="0 0 24 24"><path d="M15 7l5 5-5 5" /><path d="M20 12H9a5 5 0 0 0 0 10h2" /></symbol>
      <symbol id="plus-bold" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16" stroke-width="2.6" /></symbol>
      <symbol id="select" viewBox="0 0 24 24"><path d="M6 3.5 6 20 10.2 15.8 13 21 15.2 20 12.4 14.6 18.5 14.5z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></symbol>
      <symbol id="history" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></symbol>
      {/* THE Verlauf (top bar on every device, the drawer's title, its empty state, the help topic,
          a Checkliste item's «im Verlauf» link): #history's face and hands, its rim run back
          counter-clockwise into an arrow at the upper left – Lucide `history` on this grid (hill
          climb r27, Opus 1). The plain clock stood ~30px from the Einsatzuhr's hourglass in the
          phone bar: two time glyphs side by side. #history keeps the plain face for its other
          uses (Einsätze register, revisions, Rapport checklists). */}
      <symbol id="verlauf" viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.49-6.01L3.5 8.5" /><path d="M3.5 4v4.5H8" /><path d="M12 7.5V12l3 2" /></symbol>
      <symbol id="clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></symbol>
      {/* Die Trupp-Tafel im Navigationsband. A stopwatch, not the #gauge it wore until 04.09.: a
          pressure dial named the cylinder, and the surface is about the CLOCKS — Kontaktuhr,
          Einsatzzeit, Pause —, which a Trupp ohne Atemschutz also has and a bottle it does not.
          Distinct from #clock and #history at 20px because of the crown and the side button: a
          stopwatch is a clock somebody STARTED, which is exactly what a Trupp is. */}
      <symbol id="stopwatch" viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="7.5" /><path d="M9.5 2.5h5M12 2.5V6M12 13.5V9.2M18.6 7.5 20 6.1" /></symbol>
      {/* The Einsatzuhr's «Dauer» (lib/einsatzuhr · CLOCK_ICON). Drawn to the size of #history beside it
          in the top bar – 14×18 of the box, two rounded bulbs: the old two-V outline was 12×16 of hairline
          diagonals and read as the smallest, thinnest mark in the bar (04.11.2026, hill climb r11). */}
      <symbol id="hourglass" viewBox="0 0 24 24"><path d="M5 3h14M5 21h14M7 3v2.5a5 5 0 0 0 2.1 4.1L12 12l2.9-2.4A5 5 0 0 0 17 5.5V3M7 21v-2.5a5 5 0 0 1 2.1-4.1L12 12l2.9 2.4a5 5 0 0 1 2.1 4.1V21" /></symbol>
      <symbol id="check" viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7" stroke-width="2.2" /></symbol>
      {/* Am Einsatzort: the map's own position pin, so «vor Ort» on the crew list and a dot on
          the Lage read as the same idea. Deliberately NOT a flame — this says WHERE somebody is,
          not what is burning. */}
      <symbol id="pin" viewBox="0 0 24 24"><path d="M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5z" /><circle cx="12" cy="10" r="2.6" /></symbol>
      {/* …and its counterpart: the Magazin, a building with a door */}
      <symbol id="station" viewBox="0 0 24 24"><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9.8V20h13V9.8" /><path d="M10 20v-5.5h4V20" /></symbol>
      {/* who LEADS — the Gruppenführer crown in the Trupp picker. Outline while it is an offer,
          filled by the caller (.teamCrownOn) once it is the state, so the leader reads as a
          fact rather than as one more button that could still be pressed. */}
      <symbol id="star" viewBox="0 0 24 24"><path d="m12 3.8 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" stroke-linejoin="round" /></symbol>
      {/* Checklisten (rail, Karte, visits, admin): ONE clipboard with two ticks – #clipboard's
          shape, 2 units wider so the ticks have room (hill climb r17, Opus 11: the old stacked sheets
          with ticks and dashes went muddy at 20px beside the single-stroke stopwatch / people / box) */}
      <symbol id="checklist" viewBox="0 0 24 24"><path d="M8.5 4.5h-2a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1h-2" /><rect x="8.5" y="3" width="7" height="3.5" rx="1" /><path d="M8.8 12l2 2 4.4-4.6M8.8 17.4l2 2 4.4-4.6" /></symbol>
      {/* The Verlauf's «Pendenzen» box head: the OPEN ring every Pendenz row wears, alone, at a
          size under the rows' 20px (Journal · .jr-pinned-head draws it 10px across, 2px line, in
          their amber). It wore #checklist, the rail's Checkliste clipboard, which said «a
          Checkliste» about a list that is not one (r27); then a ring with two text bars, which at
          16px read as a typed «o=» (r28, Opus 2) – the ring alone is the rows' own mark. */}
      <symbol id="pendenzen" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" /></symbol>
      {/* An Aufgaben list in the Checkliste rail and the Nachschlagen library (23.10.2026, sweep
          F.9): two EMPTY boxes with their lines – a list still to work through. It wore #check,
          which beside «0%» read as «done»; the glyph names the kind, not a state. */}
      <symbol id="tasks" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="5.5" height="5.5" rx="1.2" /><rect x="3.5" y="14" width="5.5" height="5.5" rx="1.2" /><path d="M12.5 7.25h8M12.5 16.75h8" /></symbol>
      {/* the Rapport's signature (15.10.2026): a handwritten stroke on its line — not a pen, which
          already means «bearbeiten» everywhere; and the same stroke with a padlock for «signed,
          so locked» */}
      <symbol id="signature" viewBox="0 0 24 24"><path d="M3 15c1.5-5 3-8 4-7.5s-1 6.5.5 6.5S10 9 11 9.5s-.5 5 1 5 2-2.5 3-2.5.5 2 2 2 2.5-1 3.5-2" /><path d="M3 19.5h18" /></symbol>
      <symbol id="signature-lock" viewBox="0 0 24 24"><path d="M2 14c1.3-4.5 2.6-7 3.5-6.6S4.6 13.5 6 13.5 8.2 8.5 9 9s-.4 4.5.9 4.5 1.2-1.5 2-1.8" /><path d="M2 18.5h10" /><rect x="14" y="11.5" width="8" height="7" rx="1.6" /><path d="M15.9 11.5V9.6a2.1 2.1 0 0 1 4.2 0v1.9" /></symbol>
      <symbol id="lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></symbol>
      {/* «Mehrere platzieren» on the symbol/shape docks (20.10.2026, UX sweep M5): the repeat loop
          — the tool stays armed for the next one. It wore #lock, which already says «verriegelt»
          on a drawing and «abgeschlossen» on the Einsatz; a lit padlock read as «locked». */}
      <symbol id="place-repeat" viewBox="0 0 24 24"><path d="M17 2.5 20.5 6 17 9.5" /><path d="M3.5 11.5v-1A4.5 4.5 0 0 1 8 6h12.5" /><path d="M7 21.5 3.5 18 7 14.5" /><path d="M20.5 12.5v1A4.5 4.5 0 0 1 16 18H3.5" /></symbol>
      {/* «Einsatz abschliessen»: a lid, a box, and the thing going down into it — the action
          stamps the rapport done and ARCHIVES the Einsatz, which is what this says. It wore a
          bare `check`, the same glyph as every tick in the checklist below it, the partner boxes
          and the menu's checkmarks; on the one button that ends the Einsatz that read as one more
          tick. Not `lock` either: later corrections stay possible and print as Nachträge, so a
          padlock would promise something the app does not do. */}
      <symbol id="archive" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="4.5" rx="1.4" /><path d="M4.8 8.5v10.1a1.9 1.9 0 0 0 1.9 1.9h10.6a1.9 1.9 0 0 0 1.9-1.9V8.5" /><path d="M9.6 13.2 12 15.6l2.4-2.4M12 15.2v-4" /></symbol>
      {/* «Alle Einsätze» (20.10.2026, owner): the register of Einsätze, a list with its row marks.
          It wore `history`, the Verlauf's clock, one row away from the Verlauf button — and not
          `archive` either, which is «Abschliessen» on the card right above it. Not `menu`: that
          one has no row marks and means «more». */}
      {/* «Speicher voll» (20.10.2026, S1): the device's store, a drum. On a phone the chip shows
          only its glyph, and the ⚠ it wore was «Sync-Fehler»'s — the worse state (nothing saved
          anywhere) read as the milder one. The red chip says how bad; this says WHAT. */}
      <symbol id="storage" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v12c0 1.45 3.1 2.6 7 2.6s7-1.15 7-2.6V6" /><path d="M5 12c0 1.45 3.1 2.6 7 2.6s7-1.15 7-2.6" /></symbol>
      <symbol id="list" viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.8" cy="6.5" r="1.3" fill="currentColor" stroke="none" /><circle cx="4.8" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="4.8" cy="17.5" r="1.3" fill="currentColor" stroke="none" /></symbol>
      {/* «Wiedergabe starten» in the Verlauf head (hill climb r23, Sol 1): the ⓘ's own ring (r 9, the
          sprite's stroke) around a small filled ▶ whose centroid sits on the ring's centre. On the
          phone the button is word-less among the bare ⓘ · lens · funnel, and the bare filled #play
          was the smallest, least recognisable mark in that row; the transport controls keep #play. */}
      <symbol id="play-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M10 8.6 15.8 12 10 15.4z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" /></symbol>
      <symbol id="play" viewBox="0 0 24 24"><path d="M7 4.8 19 12 7 19.2z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></symbol>
      <symbol id="pause" viewBox="0 0 24 24"><path d="M8 5h2.4v14H8zM13.6 5H16v14h-2.4z" fill="currentColor" /></symbol>
      <symbol id="chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></symbol>
      <symbol id="chevron-left" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></symbol>
      <symbol id="chevron-down" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></symbol>
      <symbol id="chevron-up" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></symbol>
      <symbol id="skipback" viewBox="0 0 24 24"><path d="M18.5 6 11 12l7.5 6V6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /><path d="M6 5.5v13" stroke-width="2" stroke-linecap="round" /></symbol>
      <symbol id="skipfwd" viewBox="0 0 24 24"><path d="M5.5 6 13 12l-7.5 6V6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /><path d="M18 5.5v13" stroke-width="2" stroke-linecap="round" /></symbol>
      <symbol id="trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" /></symbol>
      <symbol id="rotate" viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 1-2.4-5.7" /><path d="M20 4v4.2h-4.2" /></symbol>
      <symbol id="resize" viewBox="0 0 24 24"><path d="M10 4H4v6" /><path d="M4 4l7 7" /><path d="M14 20h6v-6" /><path d="M20 20l-7-7" /></symbol>
      {/* the two single-axis grips on a Form: each says which way it moves, so a Rechteck's two
          handles can never be mistaken for the same control (01.09.) */}
      <symbol id="resize-h" viewBox="0 0 24 24"><path d="M3 12h18" /><path d="M7 8l-4 4 4 4" /><path d="M17 8l4 4-4 4" /></symbol>
      <symbol id="resize-v" viewBox="0 0 24 24"><path d="M12 3v18" /><path d="M8 7l4-4 4 4" /><path d="M8 17l4 4 4-4" /></symbol>
      {/* The FKS Entwicklung toggles (ContextPanel): an arrow per direction and its Grenze, the
          stroke across the arrow tip. The bar sits where that tip is – upright beside ← →, lying
          flat at the top beside ↑ and at the bottom beside ↓ –, so each pair reads «|←», «→|». */}
      <symbol id="spread-left" viewBox="0 0 24 24"><path d="M20 12H4.5M10 6.5 4.5 12l5.5 5.5" /></symbol>
      <symbol id="spread-right" viewBox="0 0 24 24"><path d="M4 12h15.5M14 6.5l5.5 5.5-5.5 5.5" /></symbol>
      <symbol id="spread-up" viewBox="0 0 24 24"><path d="M12 20V4.5M6.5 10 12 4.5l5.5 5.5" /></symbol>
      <symbol id="spread-down" viewBox="0 0 24 24"><path d="M12 4v15.5M6.5 14l5.5 5.5 5.5-5.5" /></symbol>
      <symbol id="grenze-v" viewBox="0 0 24 24"><path d="M12 4v16" /></symbol>
      <symbol id="grenze-up" viewBox="0 0 24 24"><path d="M4.5 4.5h15" /></symbol>
      <symbol id="grenze-down" viewBox="0 0 24 24"><path d="M4.5 19.5h15" /></symbol>
      <symbol id="move" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></symbol>
      <symbol id="measure" viewBox="0 0 24 24"><path d="M3 14.5 14.5 3 21 9.5 9.5 21z" /><path d="M7 10.5l2 2M10.5 7l2.5 2.5M14 3.5l2 2" /></symbol>
      <symbol id="polygon" viewBox="0 0 24 24"><path d="M12 3.5 20 9 17 19.5 7 19.5 4 9z" /><circle cx="12" cy="3.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="20" cy="9" r="1.5" fill="currentColor" stroke="none" /><circle cx="17" cy="19.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="7" cy="19.5" r="1.5" fill="currentColor" stroke="none" /><circle cx="4" cy="9" r="1.5" fill="currentColor" stroke="none" /></symbol>
      <symbol id="logout" viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M9 12h11M16 8l4 4-4 4" /></symbol>
      <symbol id="swap" viewBox="0 0 24 24"><path d="M4 9h13l-3-3M20 15H7l3 3" /></symbol>
      {/* an OUTLINE seen from above – OSM Umrisse, the Karte's objects and layer rows, ghost labels */}
      <symbol id="footprint" viewBox="0 0 24 24"><path d="M4 20V8h8V4h8v16z" /></symbol>
      {/* THE building, seen from the street (hill climb r20, Opus 3): the Plan's chip on the Gebäude
          stack names the building it shows, and #footprint's stepped outline at 16px read as a crop
          mark. A tall block with a low wing on the right on a ground line, filling the box like
          #warn beside it (18 × 18 of 24), at the sprite's one stroke. Two windows, not three rows
          of ticks (r21, Sol 2): at 16px six 2.5-unit ticks drew as dots, the glyph more delicate
          than the triangle and the nav icons. */}
      <symbol id="building" viewBox="0 0 24 24"><path d="M3 21h18M4.5 21V3h9.5v18M14 10h5.5v11" /><path d="M7.5 8h3.5M7.5 13h3.5" /></symbol>
      {/* the Grundriss preset (27.10.2026): a Wand is a thick corner */}
      <symbol id="wall" viewBox="0 0 24 24"><path d="M5 19V5h14" strokeWidth="4" strokeLinecap="square" /></symbol>
      <symbol id="bell" viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" /><path d="M9.5 19a2.5 2.5 0 0 0 5 0" /></symbol>
      <symbol id="bell-off" viewBox="0 0 24 24"><path d="M3 3l18 18" /><path d="M8.2 6.1A6 6 0 0 1 18 11v5l1.8 1.8M6 11.4V16l-2 2h12.6" /><path d="M9.5 19a2.5 2.5 0 0 0 5 0" /></symbol>
      {/* the Messpunkt's multigas detector (tools/gen_symbols.py · FW Messpunkt), small enough to sit inside its value pill */}
      <symbol id="messgeraet" viewBox="0 0 24 24"><rect x="6.5" y="2" width="11" height="20" rx="2.4" /><rect x="9" y="4.8" width="6" height="5" rx=".8" /><path d="M10.2 8.6l1.4-1.5 1.2.9 1.5-1.6" /><path d="M10 13.4h4" /><path d="M9.6 17.4h.01M12 17.4h.01M14.4 17.4h.01" stroke-width="2.2" /></symbol>
      <symbol id="gauge" viewBox="0 0 24 24"><circle cx="12" cy="10.5" r="7" /><path d="M12 10.5 15.4 7.9" /><circle cx="12" cy="10.5" r="1.2" fill="currentColor" stroke="none" /><path d="M10.7 17.4h2.6v1.6a1.3 1.3 0 0 1-2.6 0z" /><path d="M12 4.6v1.3M17.6 8.7l-1.2.5M6.4 8.7l1.2.5" stroke-opacity=".55" /></symbol>
      <symbol id="marquee" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3.4 3" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none" /></symbol>
      <symbol id="gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.1" /><path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.05.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-2.88-1.21l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 1.2-2.87H3a2 2 0 0 1 0-4h.09a1.7 1.7 0 0 0 1.2-2.88l-.05-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 2.87-1.2V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 2.88 1.2l.06-.05a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-1.2 2.87V10.5a1.7 1.7 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.08a1.7 1.7 0 0 0-1.52.99z" /></symbol>
      <symbol id="wind" viewBox="0 0 24 24"><path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5" /><path d="M3 16h15a2.5 2.5 0 1 1-2.5 2.5" /><path d="M3 12h7a2 2 0 1 0-2-2" /></symbol>
      <symbol id="moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></symbol>
      <symbol id="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" /></symbol>
      {/* Present-weather family (TopBar · WeatherBadge). All six embed the SAME cloud silhouette,
          each translated down by the room its accessory needs below it — and the fog variant
          rides so high that its top arc fell outside the 0 0 24 24 box and was cropped flat by
          the <symbol> viewport (snow and storm cleared that edge by a third of a stroke). The
          box was too small, not the cloud: one shared "-1 -2 26 26" gives the whole family the
          headroom and keeps the six the same size as each other. */}
      <symbol id="wx-cloud" viewBox="-1 -2 26 26"><path d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A3.75 3.75 0 0 1 17 18z" /></symbol>
      <symbol id="wx-partly" viewBox="-1 -2 26 26"><circle cx="8" cy="8" r="3.2" /><path d="M8 1.8v1.6M1.8 8h1.6M3.6 3.6l1.1 1.1M12.4 3.6l-1.1 1.1" /><path d="M9 19a3.5 3.5 0 0 1-.4-6.98 4.8 4.8 0 0 1 9.2-.9A3.3 3.3 0 0 1 18 19z" /></symbol>
      <symbol id="wx-rain" viewBox="-1 -2 26 26"><path d="M7 15a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A3.75 3.75 0 0 1 17 15z" /><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" /></symbol>
      <symbol id="wx-snow" viewBox="-1 -2 26 26"><path d="M7 14a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A3.75 3.75 0 0 1 17 14z" /><path d="M8.5 18.5v2M11.5 17.5v2M14.5 18.5v2" stroke-linecap="round" /></symbol>
      <symbol id="wx-fog" viewBox="-1 -2 26 26"><path d="M7 12a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A3.75 3.75 0 0 1 17 12z" /><path d="M5 16h14M7 19.5h12" stroke-linecap="round" /></symbol>
      <symbol id="wx-storm" viewBox="-1 -2 26 26"><path d="M7 14a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A3.75 3.75 0 0 1 17 14z" /><path d="M12 14l-2.5 4h3l-2 3.5" /></symbol>
      {/* leaving the app: the station's own forms on the Rapport (Formulare & Links) */}
      <symbol id="external" viewBox="0 0 24 24"><path d="M18 13.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5.5" /><path d="M14.5 3H21v6.5M21 3l-9.5 9.5" /></symbol>
      {/* «Überwachung abgeben» / «Weitergeben»: the QR itself is the handover gesture in an
          Einsatz — a tablet held out, not an address dictated. Three finder squares and a
          fragment of data, which is what a QR reads as at 18px. */}
      {/* Präsentationsmodus (05.11.2026): «Präsentieren» is a screen on its stand (also the
          Verlauf's «Präsentation gestartet/beendet» rows, backend app/presentation); «Zeigen» a
          fingertip with its tap ring; «Beenden» the stop square. */}
      <symbol id="present" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M12 16v4M8 20h8M9 10l2 2 4-4" /></symbol>
      <symbol id="tap" viewBox="0 0 24 24"><path d="M10 13V6.5a1.5 1.5 0 0 1 3 0V12l3.3.8a2 2 0 0 1 1.5 2.3l-.8 4.4a1.8 1.8 0 0 1-1.8 1.5H11a2 2 0 0 1-1.6-.8L6.6 16.6a1.4 1.4 0 0 1 2-2z" /><path d="M7.2 7.2a4.5 4.5 0 0 1 8.6 0" /></symbol>
      <symbol id="stop" viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></symbol>
      <symbol id="qr" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v3M17 20h4M14 20h1" /></symbol>
      <symbol id="share-ios" viewBox="0 0 24 24"><path d="M8 8.5H6.5A1.8 1.8 0 0 0 4.7 10.3v8.4a1.8 1.8 0 0 0 1.8 1.8h11a1.8 1.8 0 0 0 1.8-1.8v-8.4a1.8 1.8 0 0 0-1.8-1.8H16" /><path d="M12 14V3M8.5 6.5 12 3l3.5 3.5" /></symbol>
      {/* the Kontaktperson's number: tap to dial (Rapport + Erfassung) */}
      <symbol id="phone" viewBox="0 0 24 24"><path d="M21 16.4v2.6a1.9 1.9 0 0 1-2.1 1.9 18.9 18.9 0 0 1-8.2-2.9 18.6 18.6 0 0 1-5.7-5.7A18.9 18.9 0 0 1 2.1 4.1 1.9 1.9 0 0 1 4 2h2.6a1.9 1.9 0 0 1 1.9 1.6c.12.9.34 1.8.66 2.7a1.9 1.9 0 0 1-.43 2L7.6 9.5a15.2 15.2 0 0 0 5.7 5.7l1.2-1.2a1.9 1.9 0 0 1 2-.43c.86.32 1.76.54 2.67.66A1.9 1.9 0 0 1 21 16.4z" /></symbol>
    </svg>
  )
}

/** The Eintrag glyph's one path (#entry): three writing lines, the pencil on the last. */
const ENTRY_PATH = 'M4 6h12M4 10.5h8M4 15h3.5M10.5 19.5l.8-3.3 7.4-7.4a1.7 1.7 0 0 1 2.5 2.5l-7.4 7.4z'

/**
 * The Eintrag glyph as an INLINE path, for the two buttons that log from the field (FabEntry, the
 * top bar's Eintrag): a sprite `<use>` can fail to resolve across remounts in WebKit and render an
 * empty button (29.08.), so these carry their own path. Same `.i` class, so size and stroke match.
 * It brings its ✕ along, hidden: while the hold's chooser is up the button IS the cancel
 * (10-journal.css · `.cancelling`). The «+» turned 45° was that ✕; a pencil turned is not one,
 * so the ✕ is drawn — both always in the DOM, so nothing enters or reflows under the finger.
 */
export function EntryGlyph() {
  return <>
    <svg className="i i-entry" viewBox="0 0 24 24" aria-hidden><path d={ENTRY_PATH} /></svg>
    <svg className="i i-entry-x" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
  </>
}

export function Icon({ id, className }: { id: string; className?: string }) {
  return (
    <svg className={`i ${className ?? ''}`}><use href={`#${id}`} /></svg>
  )
}
