import { useRef, useState, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import type { RailLabels } from '../lib/prefs'
import type { PlanDocument } from '../types'
import { RAIL_COMPACT, RAIL_LABELLED, RAIL_WIDE, foldPlanTiles, railMonoMax } from '../lib/navRail'
import { RAPPORT_PAGES, type RapportPage } from '../lib/rapportPages'
import { useRail } from '../lib/useRail'
import { useKeyHints } from '../lib/useDevicePrefs'
import { useLongPress } from '../lib/useLongPress'
import { markChooserOffered, offerChooser } from '../lib/chooserOffer'
import { buzz } from '../lib/haptics'
import { PlanChooser } from './PlanChooser'
import { PlanGlyph } from './PlanGlyph'
import { GroupChooser, type GroupRow } from './GroupChooser'
import { SURFACE_KEY } from '../lib/hotkeys'
import { controlChipLabel } from '../lib/abschlussOpen'


interface Props {
  mode: 'map' | 'plans' | 'checklists' | 'atemschutz' | 'anwesenheit' | 'mittel' | 'rapport'
  onMode: (m: 'map' | 'plans' | 'checklists' | 'atemschutz' | 'anwesenheit' | 'mittel' | 'rapport') => void
  planDocs: PlanDocument[]
  activePlanId: string
  onSelectPlan: (id: string) => void
  /** Atemschutz contact-clock alarm tier (0 silent · 1 fällig · 2 überfällig) — drives a
   *  cross-surface dot on the «Trupps» item so a due Trupp is visible from any surface */
  azSeverity?: 0 | 1 | 2
  /** trailing slot after the surface list — the phone's 🔧 Bearbeiten toggle lives here
   *  (bar swap: tapping it replaces this surface bar with the tool rail) */
  trailing?: ReactNode
  /** device pref: put each surface's WORD under its glyph (lib/prefs · railLabels). Distinct from
   *  the expand chevron, which widens the rail and sets the word beside the glyph for as long as
   *  it stays open — this is a standing decision and costs ~10px, not 156. */
  labels?: RailLabels
  /** PHONE only: the bottom bar's FOLDED shape (18.09.2026). Two folds, one flag, because they
   *  are one decision — what a 360px bar can hold without scrolling:
   *    · every plan document folds into ONE «Pläne» tile (a station with four modules plus a
   *      Gebäude had eleven, so the bar scrolled and half its destinations sat behind the fade);
   *    · Anwesenheit and Material give up their own tiles to the «Rapport» tile, which becomes
   *      the DOOR to the three of them. Five tiles remain: Karte · Pläne · Checkliste · Trupps ·
   *      Rapport, and they share the bar's width evenly.
   *  ⚠️ A door, not a container. All three stay ordinary separate full pages; moving between them
   *  is a second tap or a hold on this tile, which opens the three (GroupChooser) — exactly the
   *  way the «Pläne» tile opens its documents. Folding them INTO the Rapport as extra tabs was
   *  tried on 18.09. and thrown out the same day: a whole surface mounted under the Rapport's own
   *  tab strip stacked three navigations on one screen.
   *  The vertical rail (tablet/desktop) is a column with room for all of them and is unchanged:
   *  one tile per document, and Anwesenheit/Material keep tiles of their own. */
  fold?: boolean
  /** PHONE only: the running Einsatz — what «Plan wählen» remembers having offered itself for
   *  (lib/chooserOffer). Without one the list is never opened unasked. */
  incidentId?: string
  /** PHONE only: how many people are marked present right now — the read-out on the Anwesenheit
   *  row of the page chooser. (It was the COUNT badge on the «Einsatz» tile until 26.09.2026; that
   *  badge is `openCount` now, see there.) */
  presentCount?: number
  /** PHONE only: which of the three pages the «Rapport» tile opens — the one this device left
   *  the group on, else the first-open rule (lib/rapportPages · initialRapportPage). Defaults to
   *  the Rapport itself, which is what the tile is named after. */
  rapportTarget?: RapportPage
  /** PHONE only: how many of the Rapport's Mindestangaben are still open (lib/abschluss ·
   *  missingSteps, through useAbschluss — the SAME list the Rapport's «⚠ n noch offen» chip counts)
   *  — the COUNT badge on the «Einsatz» tile and the read-out on the Rapport's row of the page
   *  chooser, both in the chip's own words (lib/abschlussOpen · controlChipLabel).
   *  ⚠️ ONE number (owner, staging 26.09.2026: «why is there 3 in the bottom when 6 are open?»).
   *  The badge used to be the HEAD COUNT (18.09.2026, so the number the folded Anwesenheit tile had
   *  stated would not vanish with it) — but the tile leads into the Rapport, whose head says «6
   *  noch offen», and a red «3» on it read as «3 open». A badge on a door says what is waiting
   *  behind it; the head count is one hold away, on the chooser's Anwesenheit row. 0 / undefined
   *  paints nothing: a Rapport with nothing open has nothing to say. */
  openCount?: number
  /** PHONE only: how many distinct Mittel positions are recorded — the Material row's read-out */
  mittelCount?: number
}

// The single left navigation rail: it switches the whole surface (Karte · the
// current object's Pläne · Checkliste) and replaces both the old TopBar mode-switch
// and the old map-panel Rail. Compact shows glyphs only; expanded adds labels. A
// drag grip on the right edge live-resizes the rail and snaps on release — overlays
// track its width through the `--rail-w` CSS variable.
//
// The mechanic itself — the scroll edges, the nudge, revealing the active surface, publishing
// the width, the grip — is lib/useRail, shared with the right ToolRail. Only the content and
// the policy below are this rail's own.
export function NavRail(p: Props) {
  const [expanded, setExpanded] = useState(false)
  const [chooser, setChooserOpen] = useState(false)
  /** every door into the list goes through here, so whichever one opened it, this Einsatz has
   *  been shown that the list exists (lib/chooserOffer) */
  const setChooser = (open: boolean) => {
    if (open && p.incidentId) markChooserOffered('plans', p.incidentId)
    setChooserOpen(open)
  }
  /** …and the same list for the «Rapport» tile's three pages. Two booleans rather than one
   *  «which chooser», because the two tiles are independent and a shared slot would let a stale
   *  value decide which sheet a tap opens. */
  const [pageChooser, setPageChooser] = useState(false)
  const nav = appConfig.copy.navRail
  // the phone bar's one plan tile — `null` with no plan documents at all, which is the rail's
  // existing empty state (no tile, and the separator above it is already conditional)
  const folded = p.fold ? foldPlanTiles(p.planDocs, p.activePlanId) : null
  // folded, the tile is the door to Rapport · Anwesenheit · Material, so it wears the word for
  // the whole record («Einsatz», owner 18.09.2026); on the rail it is the Rapport alone
  const rapportWord = p.fold ? nav.rapportGroup : appConfig.copy.modes.rapport
  // what is still open in the Rapport, on the tile that leads there — only on a folded bar (see
  // `openCount`), and only while something is
  const rapportCount = p.fold ? (p.openCount ?? 0) : 0
  /** «6 noch offen» — the Rapport chip's words for the same number (see `openCount`) */
  const openWords = (n: number) => controlChipLabel(n, 0)
  /** the «Rapport» tile stands for its whole GROUP on a folded bar, so it is lit on all three of
   *  its pages — a tile that went dark the moment its own door was used would say the operator
   *  had left the bar behind. Unfolded it is the one surface it has always been. */
  const rapportOn = p.mode === 'rapport'
    || (!!p.fold && (p.mode === 'anwesenheit' || p.mode === 'mittel'))
  /** …and it opens the page this device was last on (see `rapportTarget`) */
  const rapportGo = (p.fold ? p.rapportTarget : undefined) ?? 'rapport'
  /** The three rows behind it, in the group's own order (lib/rapportPages · RAPPORT_PAGES), each
   *  with the glyph its rail tile wears and the one number that says whether there is anything
   *  in it: «{n} noch offen» for the Rapport — the very count and words its own head chip shows,
   *  and the tile's badge — «{n} anwesend» for
   *  the Anwesenheit, «{n} Positionen» for the Material. That read-out is the whole reason the
   *  list is worth opening rather than guessing: it answers «where is the thing I came for». */
  const P = appConfig.copy
  // ⚠️ mapped over RAPPORT_PAGES, so the chooser's order and ⌘[/⌘]'s read it from one place
  const pageRows: GroupRow[] = RAPPORT_PAGES.map((page) => ({
    rapport: {
      id: page, glyph: <Icon id="doc" />, title: P.modes.rapport,
      meta: (p.openCount ?? 0) > 0 ? openWords(p.openCount ?? 0) : undefined,
      metaTone: 'open' as const,
    },
    anwesenheit: {
      id: page, glyph: <Icon id="people" />, title: P.modes.anwesenheit,
      meta: (p.presentCount ?? 0) > 0 ? fillTemplate(P.anwesenheit.summary, { present: p.presentCount ?? 0 }) : undefined,
    },
    mittel: {
      id: page, glyph: <Icon id="box" />, title: P.modes.mittel,
      meta: (p.mittelCount ?? 0) > 0 ? P.mittel.summary(p.mittelCount ?? 0) : undefined,
    },
  }[page]))
  // …and the second way into the list, for the hand that has learned press-and-hold everywhere
  // else in this app: a hold opens the chooser wherever you are standing, so reaching another
  // document never costs the trip through the one that happens to be loaded.
  const hold = useLongPress()
  /** a fired hold must not also be taken as the tap — the browser still delivers the click on
   *  release. Cleared at the START of every press, so a hold whose click never lands (a finger
   *  that slid off) cannot swallow the next tap. */
  const held = useRef(false)
  const holdProps = hold.press(() => { held.current = true; buzz(); setChooser(true) })
  /** …and its twin for the «Rapport» tile. One `useLongPress` instance serves both handles (only
   *  one press is ever live), but the «already fired» flags are per tile: a hold on one must not
   *  swallow the next tap on the other. */
  const heldR = useRef(false)
  const holdRapport = hold.press(() => { heldR.current = true; buzz(); setPageChooser(true) })

  const rail = useRail({
    varName: '--rail-w',
    compactW: p.labels === 'short' ? RAIL_LABELLED : RAIL_COMPACT,
    wideW: RAIL_WIDE,
    side: 'left',
    expanded, setExpanded,
    labels: p.labels,
    itemCount: p.planDocs.length,
    activeSelector: '.nav-item.on',
    // ⚠️ the plan tiles arrive AFTER boot and land in the middle of the list, without `mode` or
    // `activePlanId` changing — their count is part of the key so the reveal looks again.
    revealKey: `${p.mode}·${p.activePlanId}·${p.planDocs.length}`,
    // the map-control overlays drop their easing while this rail is being dragged
    dragClass: 'rail-dragging',
  })

  // ⚠️ The expanded rail's glyph column is as wide as the WIDEST monogram chip it holds (the
  // same call the chooser's glyph column makes, 05-navrail.css · .group-choose-glyph): the chip
  // keeps its height and hugs its text, so «RWA» in a fixed 26px column painted through its own
  // border (22.09.2026). CSS cannot count letters, so the rail says how many its longest has —
  // and with a digit or none the column stays the 26px an icon needs.
  // the shortcut letter on each surface tile: there while the device pref «Tastenkürzel anzeigen»
  // is on (lib/prefs · keyHints), and CSS shows it only with a mouse and keyboard to use it
  // (04b-rail.css · .rail-key). The same badge the ToolRail wears.
  const [keyHints] = useKeyHints()
  const keyHint = (k: string) => (keyHints ? <span className="rail-key" aria-hidden>{k}</span> : null)
  const monoMax = railMonoMax(p.planDocs)

  return (
    <nav className={`navrail rail${expanded ? ' expanded' : ''}${rail.dragging ? ' dragging' : ''}${p.labels === 'short' ? ' labelled' : ''}${p.fold ? ' folded' : ''}`}
      data-mono-max={monoMax}>
      {/* ⚠️ NO «Ausklappen» while the words are on. The chevron exists to reveal exactly what this
          setting already shows — with it on, expanding buys 128px of nothing but a second label
          position. It stays for everybody else, which is who it was for: somebody who does not
          know the glyphs yet and wants the names once, without a trip to the Einstellungen. */}
      {p.labels !== 'short' && (
        <button className="nav-exp rail-exp" onClick={() => rail.apply(!expanded)} aria-expanded={expanded} aria-label={expanded ? nav.collapse : nav.expand}>
          <span className="nav-exp-ic rail-exp-ic"><Icon id="chevron" className="chev" /></span><span className="rail-exp-t">{expanded ? nav.collapse : nav.expand}</span>
        </button>
      )}

      {/* surfaces — scroll if the list grows; the pinned map-controls below never scroll away.
          The wrap holds an unmasked chevron at whichever edge has hidden items (the fade alone
          was too subtle), making "scroll for more" explicit.
          ⚠️ Every rail element carries its own class AND the shared `rail-*` base (04b-rail.css):
          the base paints it, the `nav-*` name is the hook the rest of the cascade keys off — the
          phone bar rules in 15-mobile.css use several of them. */}
      <div className="rail-scroll-wrap">
      {rail.edge.top && <button type="button" className="nav-more rail-more rail-more-up" aria-label={nav.scrollMore} onClick={() => rail.nudge(-1)}><Icon id="chevron-down" /></button>}
      {rail.edge.bottom && <button type="button" className="nav-more rail-more rail-more-down" aria-label={nav.scrollMore} onClick={() => rail.nudge(1)}><Icon id="chevron-down" /></button>}
      <div ref={rail.scrollRef} className={`nav-scroll rail-scroll${rail.edge.top ? ' more-top' : ''}${rail.edge.bottom ? ' more-bottom' : ''}`}>
        <button className={`nav-item${p.mode === 'map' ? ' on' : ''}`} aria-pressed={p.mode === 'map'} aria-label={nav.map} onClick={() => p.onMode('map')}>
          <span className="nav-glyph"><Icon id="map" /></span>
          <span className="nav-label">{nav.map}</span>
          {keyHint(SURFACE_KEY.map)}
        </button>

        {/* divider ABOVE the plan group too, so the module/floor tabs read as their own
            navigable "Pläne" cluster instead of blending into the Karte icon above them */}
        {p.planDocs.length > 0 && !p.fold && <div className="nav-sep" />}
        {folded && (
          /* the ONE folded tile, and it is shaped like every other tile: ONE glyph and ONE word.
             The glyph IS the loaded document (the mono chip «1»/«RWA», the floor stack, the
             Tafel's pencil) — so the tile still says WHICH plan the next tap opens — and the word
             is the generic «Pläne», which says where it goes. It used to stack chip + «Pläne» +
             the document code, three lines of type in a 46px tile, and read cramped against the
             one-glyph-one-word tiles beside it (field report 18.09.2026). The code stays in the
             aria-label, for the reader who cannot see the glyph.
             (No badge: no plan tile carries one today. If one ever does — an alignment
             proposal, say — its union belongs on this tile, since the documents it would be
             about are no longer on the bar.) */
          <button
            className={`nav-item nav-plans${folded.many ? ' nav-grp' : ''}${p.mode === 'plans' ? ' on' : ''}`}
            aria-pressed={p.mode === 'plans'}
            aria-label={`${nav.plansGroup} · ${folded.target.code}`}
            aria-haspopup={folded.many ? 'dialog' : undefined}
            {...(folded.many ? { 'data-holdaction': true as const } : null)}
            onPointerDown={(e) => { held.current = false; if (folded.many) holdProps.onPointerDown(e) }}
            onClick={() => {
              if (held.current) { held.current = false; return } // the hold already answered
              // standing on another surface: go to the plan that was last open, never via a list —
              // except the FIRST time in an Einsatz, when the list opens over it unasked. Nothing
              // about this tile says it holds several documents, and the second tap / the hold
              // that reach them are recall, not recognition (lib/chooserOffer).
              if (p.mode !== 'plans') {
                p.onSelectPlan(folded.target.id)
                if (offerChooser({ group: 'plans', incidentId: p.incidentId, many: folded.many })) setChooser(true)
                return
              }
              // already here: the tile's second job is the choice between the documents
              if (folded.many) setChooser(true)
            }}
          >
            <PlanGlyph doc={folded.target} />
            <span className="nav-label">{nav.plansGroup}</span>
          </button>
        )}
        {!folded && p.planDocs.map((doc) => {
          const on = p.mode === 'plans' && p.activePlanId === doc.id
          // the plan's name as the label («Modul 3», «Wasser»: `code`, lib/navRail · planLabel via
          // lib/useObjectPlans) — the descriptive title overflows the rail. Module monograms sit in
          // a bordered chip (.nav-mono-chip) so they read as document tabs, not bare tool glyphs
          // («1», «2/3», «W1», «PV»); the Gebäude/Umgebung/Tafel wear an icon, un-chipped (planGlyph).
          return (
            <button key={doc.id} className={`nav-item${on ? ' on' : ''}`} aria-pressed={on} aria-label={doc.code} onClick={() => p.onSelectPlan(doc.id)}>
              <PlanGlyph doc={doc} />
              <span className="nav-label">{doc.code}</span>
            </button>
          )
        })}

        {!p.fold && <div className="nav-sep" />}
        <button className={`nav-item${p.mode === 'checklists' ? ' on' : ''}`} aria-pressed={p.mode === 'checklists'} aria-label={appConfig.copy.modes.checklists} onClick={() => p.onMode('checklists')}>
          <span className="nav-glyph"><Icon id="checklist" /></span>
          <span className="nav-label">{appConfig.copy.modes.checklists}</span>
          {keyHint(SURFACE_KEY.checklists)}
        </button>
        <button className={`nav-item${p.mode === 'atemschutz' ? ' on' : ''}`} aria-pressed={p.mode === 'atemschutz'} aria-label={appConfig.copy.modes.atemschutz} onClick={() => p.onMode('atemschutz')}>
          {/* ⚠️ A STOPWATCH, not the pressure dial this item wore until 04.09. The surface is
              «Trupps» now and it carries work squads too — a Manometer names a cylinder half of
              them do not have, while the clocks (Kontaktuhr, Einsatzzeit, Pause) are what every
              Trupp on it has and what the alarm dot beside it is about. */}
          <span className="nav-glyph"><Icon id="stopwatch" />{(p.azSeverity ?? 0) >= 2 ? <span className="nav-live nav-alarm crit" /> : null}</span>
          <span className="nav-label">{appConfig.copy.modes.atemschutz}</span>
          {keyHint(SURFACE_KEY.atemschutz)}
        </button>
        {/* ⚠️ Anwesenheit and Material have no tile of their OWN on the folded phone bar — the
            «Rapport» tile below is the door to all three (see `fold`). They are still separate
            full pages there; a second tap or a hold on that tile chooses between them. Everywhere
            else they keep the tiles they have always had. */}
        {!p.fold && (
          <button className={`nav-item${p.mode === 'anwesenheit' ? ' on' : ''}`} aria-pressed={p.mode === 'anwesenheit'} aria-label={appConfig.copy.modes.anwesenheit} onClick={() => p.onMode('anwesenheit')}>
            <span className="nav-glyph"><Icon id="people" /></span>
            <span className="nav-label">{appConfig.copy.modes.anwesenheit}</span>
            {keyHint(SURFACE_KEY.anwesenheit)}
          </button>
        )}
        {!p.fold && (
          <button className={`nav-item${p.mode === 'mittel' ? ' on' : ''}`} aria-pressed={p.mode === 'mittel'} aria-label={appConfig.copy.modes.mittel} onClick={() => p.onMode('mittel')}>
            <span className="nav-glyph"><Icon id="box" /></span>
            <span className="nav-label">{appConfig.copy.modes.mittel}</span>
            {keyHint(SURFACE_KEY.mittel)}
          </button>
        )}
        {/* The Rapport is a SURFACE, not a dialog: it is filled in across a whole Einsatz, it
            wants the full width its Zeiten grid and roster need, and as a sheet it had the Kroki
            framing modal opening on top of it — two dialogs deep. It carries R like every other
            surface carries its letter; what R used to do (Nach Norden) has the compass, which is
            on screen at all times and rotates to say so (see lib/hotkeys). */}
        {/* ⚠️ On a folded bar this tile behaves EXACTLY like the «Pläne» tile above it, because
            it is the same kind of thing: one tile standing for a group. A tap from another
            surface opens the page you were last on; a second tap — you are already inside the
            group — or a hold from anywhere opens the list of three. One mechanic, learned once,
            for both of the bar's group tiles (see GroupChooser). */}
        <button
          // `nav-grp` is the corner mark «this tile holds more than one thing» (15-mobile.css)
          className={`nav-item${p.fold ? ' nav-grp' : ''}${rapportOn ? ' on' : ''}`}
          aria-pressed={rapportOn}
          /* the badge is a NUMBER, so it has to be said and not merely painted — a dot can be
             «there is something», a count cannot be read off a coloured circle */
          aria-label={rapportCount ? `${rapportWord} · ${openWords(rapportCount)}` : rapportWord}
          aria-haspopup={p.fold ? 'dialog' : undefined}
          {...(p.fold ? { 'data-holdaction': true as const } : null)}
          onPointerDown={(e) => { heldR.current = false; if (p.fold) holdRapport.onPointerDown(e) }}
          onClick={() => {
            if (heldR.current) { heldR.current = false; return } // the hold already answered
            // standing outside the group: go to the page that was last open, never via a list
            if (!rapportOn) { p.onMode(rapportGo); return }
            // already inside it: the tile's second job is the choice between the three
            if (p.fold) setPageChooser(true)
            else p.onMode('rapport')
          }}
        >
          <span className="nav-glyph">
            <Icon id="doc" />
            {/* PHONE only, and only while something is open — see `openCount`. Same family as
                the Trupps alarm dot (.nav-live), one size up because it carries a figure: same
                corner, same white ring, so the bar has ONE badge idiom — in the chip's AMBER
                (`nav-open`): «noch offen» is a warning, not an alarm and not the station's red. */}
            {rapportCount ? <span className="nav-live nav-count nav-open" aria-hidden>{rapportCount > 99 ? '99+' : rapportCount}</span> : null}
          </span>
          <span className="nav-label">{rapportWord}</span>
          {keyHint(SURFACE_KEY.rapport)}
        </button>

        {/* (no object switch here: this rail is pure navigation, and collapsed — its default —
            it is a 60px glyph column with no room to say WHICH object is loaded. It lives on
            the Plan surface itself now, Whiteboard · .wb-object) */}
      </div>
      </div>

      {p.trailing}

      {pageChooser && folded && (
        <GroupChooser
          title={nav.pageGroup}
          rows={pageRows}
          // from outside the group (a hold on Karte) the marked row is the one a tap would open
          activeId={rapportOn ? p.mode : rapportGo}
          onPick={(id) => p.onMode(id as RapportPage)}
          onClose={() => setPageChooser(false)}
        />
      )}

      {chooser && folded && (
        <PlanChooser
          docs={p.planDocs}
          activeId={p.activePlanId}
          onPick={p.onSelectPlan}
          onClose={() => setChooser(false)}
        />
      )}

      {/* drag GRIP — aria-label only (a native `title` would pop the OS tooltip box) */}
      <button className={`nav-grip rail-grip${rail.dragging ? ' drag' : ''}`} aria-label={nav.resize} {...rail.gripProps} />
    </nav>
  )
}
