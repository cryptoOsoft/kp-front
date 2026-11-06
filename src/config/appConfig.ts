import type { AtemschutzAuftrag, EinfachAuftrag, SymbolControl } from '../types'
import { getCopy, type Copy } from './copy'

/** One symbol's curated defaults: which built-in steppers make sense for it
 *  (`controls`) and the empty detail rows it drops in with (`fields`). Omitted
 *  `controls` = none; omitted `fields` = no detail rows. See lib/symbols. */
/** One alarm stage of a measured field: reached from `atLeast`, or below `below`. */
interface AlarmLimit {
  atLeast?: number
  below?: number
}

interface SymbolPreset {
  controls?: SymbolControl[]
  fields?: string[]
  /** which detail field is the symbol's identity at a glance — printed under the glyph in
   *  the 'auto' caption mode (lib/symbols · symbolCaptionText). Defaults to the first `fields`
   *  entry when omitted; set it where the first field isn't the readable one (e.g. a
   *  Gefahrentafel leads with 'UN-Nr.' but 'Stoff' is what a passing operator wants to read). */
  caption?: string
  /** which `fields` are MEASURED VALUES («CO», «O₂» …): a bare «180» names nothing, so every
   *  place that prints one keys it («CO 180»), and the first filled one rides on the glyph as
   *  its readout instead of hanging under it as a caption (lib/symbols · symbolReadoutText). */
  readout?: string[]
  /** the detector's two alarm stages per `readout` key: `a1` (Voralarm, amber) and `a2`
   *  (Hauptalarm, red), each from `atLeast` and/or `below` – O₂ alarms both ways. The higher stage
   *  wins. Station-overridable via the config (lib/symbols · readingLevel). */
  alarm?: Record<string, { a1?: AlarmLimit; a2?: AlarmLimit }>
  /** minutes after which the last reading counts as old: the mark keeps its colour on the outline
   *  and says its age («18′») – an old danger must stay visible without looking fresh. */
  staleMin?: number
  /** shipped suggestion lists for detail fields, keyed by field name. A hint, never a cage:
   *  the field stays free text, and a deployment's own `fleet.attributeLists` entry for the
   *  same symbol+field wins over anything here (lib/symbols · symbolFieldOptions). */
  fieldOptions?: Record<string, string[]>
  /** detail fields that hold a NUMBER: the panel draws the ± stepper the built-in count wears
   *  instead of a text field (lib/symbols · symbolFieldKind). Still stored as a string, so a
   *  value typed as free text before keeps showing — and editing — as text (countFieldValue). */
  fieldKinds?: Record<string, 'count'>
}

const base = {
  appName: 'Incident Map',
  locale: 'de-CH',
  storage: {
    key: 'incident-map-workspace-v1',
    legacyKeys: ['kp-front-poc-v5'],
  },
  // Rückmeldung (see lib/feedbackReport). Nothing is ever sent automatically — this is only the
  // address the «E-Mail schreiben» button pre-addresses, and the operator sees the whole text
  // first. Upstream by default so a fresh self-hosted station's feedback reaches the people who
  // can act on it; a deployment that would rather triage internally overrides `mailto` with its
  // own address and upstream never hears from it, which is the correct default for a project
  // whose promise is that the station owns its data.
  feedback: {
    mailto: 'bastian.eichenberger@feuerwehr-oberwil.ch',
    // The other exit. Since the maintainer's ingest was retired (PRIVACY.md § «Where it
    // goes») these two links ARE the reporting channel — nothing travels on its own any
    // more — so the issue form is the one that gets the structure: it can demand a version
    // and the Diagnose-Datei, which a free-text mail cannot. A station that triages
    // internally overrides `mailto` and can blank `github` to hide the route entirely.
    github: 'https://github.com/feuerwehr-oberwil/kp-front',
  },
  defaults: {
    operationalLayerId: 'taktisch', // placed symbols
    drawingLayerId: 'markup',   // freehand/area drawings, notes, photos
    snapshotFilePrefix: 'incident-map-snapshot',
    /** undo-history depth, shared by the Lage map doc and the Plan board (one cap
     *  instead of the map's old 60 vs the plan's old 80) */
    historyCap: 80,
    /** metres the auto-surfaced object may lie from the Einsatzadresse before the Plan warns
     *  «nicht die Einsatzadresse» (station override: `doctrine.nearbyObjectWarnM`) */
    nearbyObjectWarnM: 25,
  },
  // Journal composer: national default Textbausteine (quick phrases) — fuzzy-completed while
  // typing (src/lib/quickPhrases.ts), so the list can be generous: only the 3 best matches
  // surface. Keep entries short Meldung style with distinct first words (fast prefix hits) and
  // generic national wording — brigade-specific partners belong in the station override
  // (deployment config journal.quickPhrases); content stays German domain language.
  journal: {
    quickPhrases: [
      // Führung / Ablauf
      'Rekognoszierung läuft',
      'Erkundung abgeschlossen',
      'Einsatzleitung übernommen',
      'Lagemeldung an Einsatzzentrale',
      'Verstärkung angefordert',
      'Retablierung läuft',
      'Rückbau eingeleitet',
      'Einsatzbereitschaft wiederhergestellt',
      'Übergabe an Eigentümer',
      // Brand
      'Brand unter Kontrolle',
      'Feuer aus',
      'Nachlöscharbeiten laufen',
      'Brandwache gestellt',
      'Entrauchung eingeleitet',
      'Atemschutz eingesetzt',
      'Wasserversorgung erstellt',
      // BMA
      'Fehlalarm BMA',
      'Nichts festgestellt',
      'BMA zurückgestellt',
      // Personen
      'Gebäude geräumt',
      'Keine Personen im Gebäude',
      'Person gerettet',
      'Patient an Sanität übergeben',
      // Partner
      'Sanität aufgeboten',
      'Sanität vor Ort',
      'Polizei aufgeboten',
      'Polizei vor Ort',
      'Nachbarfeuerwehr aufgeboten',
      // Elementar / Technik
      'Strom abgeschaltet',
      'Gas abgestellt',
      'Strasse gesperrt',
      'Verkehrsdienst eingerichtet',
      'Pumpen eingesetzt',
      'Ölspur gebunden',
    ],
    // The abbreviations the Funkverkehr actually speaks — read off ten weeks of real prod
    // Verlauf-Einträge (10.09.2026), where every one of them was typed out by hand and none was
    // completed by anything. They are SPELLING HELP, not vocabulary: they complete in the
    // composer and are never marked in the Verlauf or on the Rapport (journalLinks · plain), and
    // the chip inserts the SPOKEN form — the record has to read the way it was said on the radio,
    // so «Hösi Gruppe bereitstellen» stays that and does not become «Höhensicherung Gruppe …».
    // The long form rides along on the chip only, for the 3am moment when the letters alone are
    // not enough.
    // ⚠️ Ordered by how often the corpus used them: at one typed letter the likeliest wins, and
    // that order is the only thing deciding it.
    // ⚠️ «DL» has two readings that are both right depending on the Einsatz, so the chip names
    // both and inserts the same two letters either way rather than guessing. ONE entry, not two:
    // the suggestion band dedupes by label, so a second «DL» would have been silently dropped
    // and only the first reading would ever have been read.
    abbreviations: [
      { term: 'AS', long: 'Atemschutz' },
      { term: 'Hösi', long: 'Höhensicherung' },
      { term: 'MS', long: 'Motorspritze' },
      { term: 'OF Front', long: 'Offizier Front' },
      { term: 'BF', long: 'Berufsfeuerwehr' },
      { term: 'Frz', long: 'Fahrzeug' },
      { term: 'RWA', long: 'Rauch-/Wärmeabzug' },
      { term: 'SA', long: 'Schnellangriff' },
      { term: 'TS', long: 'Teilstück' },
      { term: 'DL', long: 'Druckleitung / Drehleiter' },
      { term: 'WBK', long: 'Wärmebildkamera' },
      { term: 'GF', long: 'Gruppenführer' },
      { term: 'ADF', long: 'Angehöriger der Feuerwehr' },
      { term: 'pax', long: 'Personen' },
    ],
    // Where on the Schadenplatz something is. The same corpus wrote «1. OG» in six spellings
    // («1og», «1, og», «1 og», «2. OG», «2OG», «2.Og») — which is not only slower to type but
    // makes the Rapport unsearchable, so this list exists as much for the record as for the
    // thumb. Plain like the abbreviations above: a Geschoss is not one of the Einsatz's own
    // words, and marking every one of them would leave a busy line coloured end to end.
    locations: [
      'Keller', '2. OG', '1. OG', 'UG', 'EG', 'Dach', '3. OG', '4. OG',
      'Estrich', 'Treppenhaus', 'Nebengebäude', 'Brandwohnung', 'Schadenplatz', 'Sammelplatz',
    ],
  },
  // Live vehicle GPS, pulled from our own backend's Traccar integration. With
  // baseUrl empty (the default) the path is same-origin — served by the backend
  // in production and by the Vite proxy in dev. If the deployment has no Traccar
  // configured, the backend answers 503 and polling stops (layer stays empty).
  // VITE_KP_RUECK_URL only overrides the origin for a split-origin setup.
  gps: {
    baseUrl: (import.meta.env.VITE_KP_RUECK_URL ?? '').replace(/\/$/, ''),
    positionsPath: '/api/traccar/positions',
    layerId: 'fahrzeuge',
    pollMs: 15_000,
    // Breadcrumbs behind each vehicle. Own layer and OFF by default: on a busy Lage the tracks
    // compete with the tactical symbols, and the question they answer ("where did it come
    // from?") is one you ask occasionally, not continuously. Polled only while the layer is
    // actually visible — an unopened layer costs nothing.
    trailsPath: '/api/traccar/trails',
    trailsLayerId: 'fahrzeugspuren',
    trailMinutes: 30,
    trailsPollMs: 30_000,
    // each live vehicle renders a generic vehicle glyph with its name + heading
    // baked in (see lib/useVehiclePositions.ts · vehicleSymbolSvg); no per-name
    // symbol mapping needed.
    status: { online: 'Online', offline: 'Offline', unknown: 'Unbekannt' } as Record<string, string>,
  },
  // Standort teilen — crew members reporting their own position from their own phones, so the
  // command post can see where people are working (the Wassertransport several kilometres out
  // is the case this exists for). Own-backend, same-origin, one row per person, gone when the
  // Einsatz closes. Nothing here alerts on distance: being far away is normal and useful.
  personGps: {
    layerId: 'personen',
    /** how often the command post asks for the picture */
    pollMs: 15_000,
    /** how often a sharing phone reports, at most (a fix that hasn't moved still refreshes
     *  the age, which is what tells the FU the picture is current) */
    sendMs: 20_000,
    /** report immediately when the phone has moved at least this far since the last send —
     *  someone driving to the Weiher shouldn't crawl across the map in 20 s steps */
    minMoveM: 25,
    /** GPS fixes worse than this are dropped rather than drawn: a 2 km circle rendered as a
     *  dot is a lie, and indoors/underground that is exactly what a phone reports */
    maxAccuracyM: 500,
    selfReported: 'Selbstauskunft',
    copyFields: { lastFix: 'Letzte Position', accuracy: 'Genauigkeit' },
  },
  // Multi-device live sync (HTTP, no WebSocket — the backend is last-write-wins on the
  // full workspace blob, polled with a `since`-rev conditional GET that 304s when nothing
  // changed). Two knobs set how fast an edit on one device appears on another:
  //   saveDebounceMs — how long after the LAST edit the drawing device pushes to the server.
  //                    The debounce re-arms on every edit, so a continuous gesture (a freehand
  //                    stroke, a drag) flushes once, ~this long after it ends — not per point.
  //   livePollMs     — how often the other devices poll for a newer revision.
  // Worst-case cross-device latency ≈ saveDebounceMs + livePollMs + one round-trip.
  sync: {
    saveDebounceMs: 600,
    livePollMs: 2000,
    // Battery: the 2 s live-poll is the fast cadence used while the incident is active. When
    // polls keep returning nothing new, the loop eases off (doubling) toward livePollMaxMs so a
    // quiet incident stops pinning the cellular radio awake; any change snaps it back to
    // livePollMs. A backgrounded tab polls at hiddenPollMs (nothing on screen to keep fresh) and
    // catches up immediately on the visibility-return. See lib/pollBackoff.
    livePollMaxMs: 15000,
    hiddenPollMs: 60000,
    // …EXCEPT while this device is sounding the Atemschutz alarm: the event that ends the tone
    // (a Funkkontakt or Druckmeldung, usually entered on ANOTHER device) arrives via this very
    // poll, so a backgrounded tablet ringing at the 60 s cadence keeps alarming long after the
    // Trupp was handled. While alarming, a hidden tab polls at this rate — the battery argument
    // does not apply to a device that is actively making noise.
    hiddenAlarmPollMs: 5000,
  },
  // The weather badge's detail target (MeteoSwiss radar) is locale-dependent and lives in
  // the copy catalogues: appConfig.copy.weather.detailsUrl.
  symbols: {
    namePrefixes: ['VKF', 'FW', 'FWD', 'FKS', 'WV', 'Abw', 'Rettung', 'GVB', 'SI', 'GB', 'ZS', 'fw'],
    // the generic vehicle glyph — placed copies render their (typed) name baked in,
    // exactly like the live GPS vehicles (see lib/useVehiclePositions · vehicleSymbolSvg)
    vehicleName: 'VKF Fahrzeug',
    // the FIRE family: a symbol marked «Gelöscht / erledigt» (lib/objectDone) says «gelöscht»,
    // every other symbol «erledigt». Not the whole «Schadenlage» category — a Rettung, a Wasser
    // or an Unfall is never «gelöscht». Names are the pack's compatibility keys.
    fireFamily: ['VKF Feuer'] as string[],
    // …and the ONLY symbols «Gelöscht / erledigt» is offered for (owner's sign-off on #226,
    // 26.09.2026: «only support this for some types. we don't need "erledigt" for cars»): the
    // damage and hazard categories of the pack — Feuer, Rauch, Rettung, Wasser, Unfall, Explosion,
    // Gefahrstoffe, the Gefahr signs — plus the fire family above. A Fahrzeug, a KP Front, a
    // Hydrant, an Einsatzmittel never gets the row; where it is offered it is the editor's FIRST
    // row, because being over is the next thing that happens to a fire (lib/objectDone).
    doneCategories: ['Schadenlage', 'Gefahren'] as string[],
    // detail fields that offer the Mannschaft roster as a combobox (person pickers).
    // «Bedienung» (14.09.) = the person operating a placed device – Lüfter, Pumpe, Absperrung …
    // It is the LAST field of every manned preset below, so the existing caption/field order is
    // untouched, and it marks the person present as «Bedienung Lüfter» (lib/roleAssignment).
    rosterFields: ['Name', 'Fahrer', 'Stv.', 'Bedienung'],
    // «Herkunft» (05.11.2026): where a vehicle comes from when it is NOT the own Feuerwehr
    // (Stützpunkt, Zivilschutz, Wache Nord …). The second field of every driven vehicle below and
    // of a live GPS vehicle (lib/useVehicleLayer); its list is the station's `fleet.origins`,
    // one list for all of them (lib/symbols · symbolFieldOptions). Empty = own Feuerwehr.
    originField: 'Herkunft',
    // symbols whose roster picker offers a "nur Offiziere" filter + officer-first order
    // (leadership glyphs where you pick the FU/EL/officer by name) — same toggle as the
    // Einsatzleiter picker in the Rapport preflight.
    officerRosterSymbols: ['FW Offizier', 'VKF Einsatzleiter', 'VKF KP Front'],
    // the orange ADR Warntafel symbol — when it carries a UN-Nr field, the icon renders
    // as a real plate with the Gefahrnummer (Kemler) over the UN number baked in (see
    // lib/placard · placardSvgForSymbol), the same way the vehicle bakes its name.
    placardName: 'FW Gefahr Tafel',
    /** The station-common substances offered one pick away on the Gas/Chemie hazard symbols
     *  (Feldtest Manuel, 07.09.). Labels are the words a firefighter says — «Salzsäure», not
     *  the official «CHLORWASSERSTOFFSÄURE» — and the UN behind each label is what feeds the
     *  ADR/ERG readout and the Schutzabstand rings; anything not on a list is found by name
     *  through the Stoff search (full ADR table) or typed free. German like every other
     *  structural preset value (see the Rettungen Status list). */
    unCommons: {
      'FW Gefahr G': [
        { label: 'Propan', un: '1978' },
        { label: 'Butan', un: '1011' },
        { label: 'Erdgas / Methan', un: '1971' },
        { label: 'Flüssiggas (LPG)', un: '1965' },
        { label: 'Acetylen', un: '1001' },
        { label: 'Ammoniak', un: '1005' },
        { label: 'Chlor', un: '1017' },
        { label: 'Wasserstoff', un: '1049' },
        { label: 'Sauerstoff', un: '1072' },
        { label: 'Kohlendioxid', un: '1013' },
      ],
      'FW Gefahr C': [
        { label: 'Salzsäure', un: '1789' },
        { label: 'Schwefelsäure', un: '1830' },
        { label: 'Natronlauge', un: '1824' },
        { label: 'Ammoniaklösung', un: '2672' },
        { label: 'Javelwasser (Hypochlorit)', un: '1791' },
        { label: 'Wasserstoffperoxid', un: '2014' },
        { label: 'Benzin', un: '1203' },
        { label: 'Diesel / Heizöl', un: '1202' },
        { label: 'Aceton', un: '1090' },
      ],
    } as Record<string, { label: string; un: string }[]>,
    // the Rettungs-Symbol. Its count stepper reads «Anzahl Personen» and its second field is
    // «Anzahl Tiere», so it carries both figures the Rapport asks for under «Gerettete» — which
    // is what lib/gerettete offers back into the form instead of making somebody re-count the
    // Kroki by eye at the end of an Einsatz.
    rescueName: 'VKF Rettungen',
    /** Partner-Bereiche → the Partnerorganisation each one means, so a Kroki that already shows
     *  where the Polizei stands can OFFER «Polizei» into the Rapport's checklist instead of
     *  making somebody remember it an hour later (lib/partnerOrgs · partnerOrgsFromLage).
     *
     *  Each entry lists the spellings a station's own `report.partnerOrgs` list may use — the
     *  match is case-insensitive and the STATION's spelling is what ends up on the rapport, so
     *  an organisation the list does not carry is never invented here.
     *
     *  ⚠️ Only the unambiguous ones. «VKF Bereich Feuerwehr» is left out on purpose: on most
     *  Krokis it marks the OWN Wehr, not a partner, and a nachbarliche Wehr uses the same glyph —
     *  an offer that is wrong half the time is worse than no offer. The Sanitäts-Einrichtungen
     *  (Patientensammelstelle, Sanitätshilfsstelle, Verwundetennest) are out for the same reason:
     *  the Feuerwehr sets them up itself, before anybody from the Sanität is on site. */
    partnerOrgSymbols: {
      'VKF Bereich Polizei': ['Polizei', 'Police', 'Kantonspolizei', 'Kapo', 'Stadtpolizei'],
      'VKF Bereich Sanitaet': ['Sanität', 'Sanitaet', 'Sanitätsdienst', 'Rettungsdienst', 'Ambulanz'],
      'VKF Bereich Chemiewehr': ['Chemiewehr'],
      'VKF Bereich Zivilschutz': ['Zivilschutz', 'ZSO'],
    } as Record<string, string[]>,
    // the Einsatzleiter glyph. Its 'Name' field is the person in charge, so a Kroki that carries
    // one pre-fills the Rapport's Einsatzleiter (lib/report · einsatzleiterFromScene).
    einsatzleiterName: 'VKF Einsatzleiter',
    // …and the glyphs whose Name/Stv. pair IS the Einsatzleiter and deputy (14.09.: the KP Front
    // carries the same pair). Drives the EL/Stv. row labels + the ⇄ handover (ContextPanel) and
    // the el role on the Anwesenheit (lib/roleAssignment). The EL glyph stays first: it wins the
    // Rapport pre-fill.
    einsatzleiterSymbols: ['VKF Einsatzleiter', 'VKF KP Front'],
    // NOTE: the old `rotatable` list is gone — a symbol is rotatable iff its preset
    // (below) lists 'rotation' in `controls`, so the drag-to-rotate handle and the
    // editor's Drehung stepper stay in sync from one source (see lib/symbols ·
    // ROTATABLE / symbolControls).
    // short, clear display labels (raw library name → label). Anything not listed
    // falls back to the prefix-stripped + umlaut-restored name.
    displayNames: {
      'VKF Feuer': 'Feuer',
      'VKF Rettungen': 'Rettung',
      'VKF Unfall': 'Unfall',
      'VKF Gefaehrliche Stoffe': 'Gefahrstoffe',
      'VKF Wasser': 'Wasser',
      // damage/Naturereignis signatures (Faltkarte 11/2022, added 2026-07-02)
      'FW Beschaedigung': 'Beschädigung',
      'FW Teilzerstoerung': 'Teilzerstörung',
      'FW Totalzerstoerung': 'Totalzerstörung',
      'FW Ueberschwemmung': 'Überschwemmung',
      'FW Gefahr allgemein': 'Gefahr',
      'FW Gefahr Tafel': 'Gefahrentafel',
      'FW Gefahr Radioaktiv': 'Radioaktiv',
      'FW Gefahr Ex': 'Explosion',
      'FW Gefahr G': 'Gas',
      'FW Gefahr C': 'Chemie',
      'FW Gefahr W': 'Wasser',
      'FW Elektroanlage': 'Elektroanlage',
      'FW Messpunkt': 'Messpunkt',
      'VKF Patientensammelstelle': 'Patientensammelstelle',
      'VKF Sanitaetshilfsstelle': 'Sanitätshilfsstelle',
      'VKF Totensammelstelle': 'Totensammelstelle',
      // FKS audit: this glyph (rectangle + two horizontal lines) is the FKS sign for Unverletzte,
      // not a generic Sammelstelle — the assembly point is the separate FW Sammelplatz (□ + S).
      'VKF Sammelstelle': 'Unverletzte',
      'FW Sammelplatz': 'Sammelplatz',
      'FW Warteraum': 'Warteraum',
      'FW Verwundetennest': 'Verwundetennest',
      'VKF Bereich Sanitaet': 'Sanität',
      'VKF KP Front': 'KP Front',
      'VKF Einsatzleiter': 'Einsatzleiter',
      'FW Offizier': 'Offizier',
      'VKF Kontrollposten': 'Kontrollposten',
      'VKF Informationszentrum': 'Informationszentrum',
      'VKF Bereich Materialdepot': 'Materialdepot',
      'VKF Verkehrssperre ueberwacht': 'Verkehrssperre',
      'VKF Drehleiter': 'Drehleiter',
      'VKF Hubretter': 'Hubretter',
      'VKF Fahrzeug': 'Fahrzeug',
      'VKF Pumpe Typ2': 'Pumpe',
      'FW Tauchpumpe': 'Tauchpumpe',
      'FW Wassersauger': 'Wassersauger',
      'VKF Helilandeplatz': 'Helilandeplatz',
      'VKF Drohne': 'Drohne',
      'VKF Luefter mobil': 'Lüfter',
      'FW Entrauchung': 'Entrauchung',
      'FW Kleinloeschgeraet': 'Kleinlöschgerät',
      'FW Sprungretter': 'Sprungretter',
      'FW Leiter': 'Leiter',
      'SI Ueberflurhydrant': 'Überflurhydrant',
      'SI Unterflurhydrant': 'Unterflurhydrant',
      'VKF Innenhydrant': 'Innenhydrant',
      'SI Wasserloeschposten': 'Wasserlöschposten',
      'WV Loeschweier': 'Löschweiher',
      'SI Wasserbezugsort': 'Wasserbezugsort',
      'SI Wasserdruckversorgung': 'Wasserdruckversorgung',
      'GB Lift': 'Lift',
      'GB Kamin': 'Kamin',
      'GB Abzug': 'Abzug',
      'SI Schieber': 'Schieber',
      'GB Elektrotableau': 'Elektrotableau',
      'GB Sprinklerzentrale': 'Sprinklerzentrale',
      'GB Brandmeldezentrale': 'Brandmeldezentrale',
      'GB BMA Melder': 'BMA Melder',
      'GB BMA-Z': 'BMA-Z',
      'GB RWA-BS': 'RWA-BS',
      'FW AED': 'AED',
      'GB Fernsignaltableau': 'Fernsignaltableau',
      'GB Schluesseldepot': 'Schlüsseldepot',
      'GB BA Wand F30': 'Wand F30',
      'GB BA Wand F60': 'Wand F60',
      'GB BA Wand F180': 'Wand F180',
      'GB Ture BS R30': 'Türe R30',
      'GB Ture Durchgang': 'Durchgang',
      'GB Treppe 8': 'Treppe',
      'SI Nordpfeil': 'Nordpfeil',
      'SI Windrichtung': 'Windrichtung',
      'VKF Bereich Polizei': 'Polizei',
      'VKF Bereich Chemiewehr': 'Chemiewehr',
      'VKF Bereich Zivilschutz': 'Zivilschutz',
      'VKF Bereich Feuerwehr': 'Feuerwehr',
    } as Record<string, string>,
    // Per-symbol presets. On placement a symbol drops in with its empty `fields`
    // rows (operator just fills the blanks) and the editor shows only the `controls`
    // steppers that carry meaning for it: 'rotation' for directional glyphs (arrows,
    // ladders, walls), 'count' where several can stack on one marker, 'floor' (map
    // only) for things tied to a storey. Looked up by exact name first, then the
    // category fallback, else: no controls, no fields. One curated list for all 65
    // library symbols — keep it the single source for both fields and gating.
    presets: {
      byName: {
        // ── Schadenlage ── on a storey; the label carries the rest. Damage of this kind
        // rarely sits on exactly one floor (a fire climbs, smoke drifts up the stairwell,
        // water runs down) — von/bis (03.09.) says the span in one badge instead of forcing
        // a second symbol per storey. A single-storey case is still one tap: fill only
        // «von» and the badge shows just that value (see floorRangeBadge).
        'VKF Feuer': { controls: ['floorRange', 'spread'] },
        // ⚠️ These four carried NO preset at all, so they were the only Schadenlage symbols
        // without a storey — while Feuer, Rauch, Wasser, Unfall, Gefahrstoffe and
        // Rettungen all have one. Damage in a building happens on a floor, and «Teilzerstörung»
        // with no storey is exactly the statement a Kroki cannot afford to leave vague.
        // ⚠️ Beschädigung/Teilzerstörung/Totalzerstörung upgraded to von/bis alongside Feuer
        // (03.09.) — a Totalzerstörung spans a house's floors as often as a single storey does.
        'FW Beschaedigung': { controls: ['floorRange'] },
        'FW Teilzerstoerung': { controls: ['floorRange'] },
        'FW Totalzerstoerung': { controls: ['floorRange'] },
        'FW Ueberschwemmung': { controls: ['floorRange'] },
        'VKF Rauch': { controls: ['floorRange', 'spread'] },
        // ⚠️ «Vermisst» and «eingesperrt» are STATES of a Rettung, not symbols of their own.
        // The count and the storey were already here; what the map could not say was whether
        // those three on the 2nd floor are still unaccounted for or known and trapped, which
        // is the difference between a search and a rescue. Free text stays possible — the list
        // is the fast path, not a cage (a station overrides it via fleet.attributeLists).
        // «Anzahl Tiere» sits beside the count stepper, which on this symbol reads «Anzahl
        // Personen» (copy · countBySymbol). A Stall, a Wohnung mit Hund, ein Pferd im Anhänger:
        // the animals are rescued, they are reported, and the Rapport has counted them
        // separately from the people all along (report · gerettete {personen, tiere}) — the
        // symbol was the one place the two could not be told apart. Second field, so the
        // «Auto»-Beschriftung stays the Status (fields[0]); a ± stepper since 27.10.2026.
        'VKF Rettungen': {
          controls: ['count', 'floor'],
          fields: ['Status', 'Anzahl Tiere'],
          fieldOptions: { Status: ['vermisst', 'eingesperrt', 'gerettet'] },
          // a count like the person count beside it (sweep 27.10.2026 #14), not a text field
          fieldKinds: { 'Anzahl Tiere': 'count' },
        },
        'VKF Unfall': { controls: ['floor'] },
        // von/bis (03.09.): Gefahrstoffe and Wasser spread through a building the same way
        // Feuer/Rauch do, above.
        'VKF Gefaehrliche Stoffe': { controls: ['floorRange', 'spread'], fields: ['Stoff'] },
        'VKF Wasser': { controls: ['floorRange', 'spread'] },
        // FKS Schlüsselstelle (library, previously category fallback): a tactically decisive spot
        // somebody is posted at — keeps the Schadenlage storey, gains the Bedienung picker.
        'FKS Schluesselstelle': { controls: ['floor'], fields: ['Bedienung'] },
        // ── Gefahren ── floor badge; hazmat seeds just the substance. The generic hazard
        // seeds a 'Gefahr' row (caption via fields[0]): the glyph alone says only «something
        // dangerous here» — WHAT it is («Einsturz», «Dachlawine») is the map's actual message.
        'FW Gefahr allgemein': { controls: ['floor'], fields: ['Gefahr'] },
        // Gas leaks/rises through more than one storey as often as a fire does (03.09.: von/bis).
        // Both hazard symbols carry the UN pair since 07.09. (Feldtest Manuel): the Stoff row
        // offers the station-common substances one pick away (symbols.unCommons below) plus a
        // full-ADR name search, and a resolved UN lights the same ADR/ERG readout and
        // Schutzabstand rings the Gefahrentafel has. Stoff first — the substance is what the
        // operator knows and what the caption reads.
        'FW Gefahr Ex': { controls: ['floor'] },
        'FW Gefahr G': { controls: ['floorRange'], fields: ['Stoff', 'UN-Nr.'], caption: 'Stoff' },
        'FW Gefahr C': { controls: ['floor'], fields: ['Stoff', 'UN-Nr.'], caption: 'Stoff' },
        // Gefahrentafel = orange UN placard; UN-Nr. first (future lookup UN→Stoff fills the rest),
        // but the substance is what an operator reads off the map → caption on 'Stoff'.
        // ⚠️ symbols saved before the key gained its dot store 'UN-Nr' — readers match
        // dot-tolerantly (ContextPanel, placard) so those keep working.
        'FW Gefahr Tafel': { controls: ['floor'], fields: ['UN-Nr.', 'Stoff'], caption: 'Stoff' },
        'FW Gefahr Radioaktiv': { controls: ['floor'] },
        'FW Elektroanlage': { controls: ['floor'] },
        'FW Gefahr W': { controls: ['floor'] },
        // Messpunkt (26.10.2026): one point per room, the multigas detector's four channels as
        // its measured fields – one radio report («CO 72, Ex null, O₂ 20,9») fills them in one go. CO
        // first: it is what a Nachkontrolle measures and what the readout shows by default.
        // Raum first, the way the Trupp reports it («2. OG Gang: …»), and it is the caption: the
        // values ride on the glyph itself, so under it only the room is left to say.
        // The alarm stages are the Dräger-typical A1/A2 settings (CO 30/60 ppm, Ex 10/20 %UEG, H₂S
        // 5/10 ppm, O₂ A1 below 19, A2 from 23 Vol%) until a station overrides them with what its
        // own Multiwarn is set to – plus O₂ red below 17 Vol%, where a filter mask stops being allowed.
        'FW Messpunkt': {
          controls: ['floor'], fields: ['Raum', 'CO', 'Ex', 'O₂', 'H₂S'], caption: 'Raum', readout: ['CO', 'Ex', 'O₂', 'H₂S'],
          alarm: {
            CO: { a1: { atLeast: 30 }, a2: { atLeast: 60 } },
            Ex: { a1: { atLeast: 10 }, a2: { atLeast: 20 } },
            'O₂': { a1: { below: 19 }, a2: { below: 17, atLeast: 23 } },
            'H₂S': { a1: { atLeast: 5 }, a2: { atLeast: 10 } },
          },
          staleMin: 15,
        },
        // ── Personen / Sanität ── the label/name says it; no count on the plain places. A
        // Sammelstelle is RUN by somebody (14.09.: «Bedienung» roster picker, last field).
        'VKF Patientensammelstelle': { controls: ['count', 'floor'], fields: ['Bedienung'] },
        'VKF Sanitaetshilfsstelle': { controls: ['count', 'floor'], fields: ['Bedienung'] },
        'VKF Totensammelstelle': { controls: ['count', 'floor'], fields: ['Bedienung'] },
        'VKF Sammelstelle': { controls: ['count', 'floor'], fields: ['Bedienung'] },   // FKS: Unverletzte (see displayNames)
        'FW Sammelplatz': { fields: ['Bedienung'] },
        'FW Warteraum': { fields: ['Bedienung'] },
        'FW Verwundetennest': { controls: ['count', 'floor'], fields: ['Bedienung'] },
        // ZS-Stellen (FireGIS library, previously no preset) – manned like the ones above.
        'ZS Angehoerigensammelstelle': { fields: ['Bedienung'] },
        'ZS Verpflegungsabgabestelle': { fields: ['Bedienung'] },
        'ZS Betriebsstoffabgabestelle': { fields: ['Bedienung'] },
        'ZS Dekontaminationsstelle': { fields: ['Bedienung'] },
        'VKF Bereich Sanitaet': { fields: ['Einheit'] },
        // AED placard — floor only, like the other Wand-Piktogramme added 02.09. No Bedienung:
        // the placard marks where the device hangs, nobody mans a wall sign.
        'FW AED': { controls: ['floor'] },
        // ── Führung ── name is the info; the person symbols seed 'Name', the posts a 'Bedienung'.
        // KP Front carries the SAME pair as the Einsatzleiter glyph (14.09.): Name = the EL,
        // Stv. = deputy, officer-first pickers, EL/Stv. row labels and the ⇄ handover — a Kroki
        // that places the KP Front instead of the EL figure names the same two people.
        'VKF KP Front': { fields: ['Name', 'Stv.'] },
        // Name = the Einsatzleiter (caption source, fields[0]); Stv. = deputy — both roster pickers
        // (officer-first, since VKF Einsatzleiter is in officerRosterSymbols).
        'VKF Einsatzleiter': { fields: ['Name', 'Stv.'] },
        // 'Funktion' = separate Führungsaufgabe picker (Front/SiBe/…); 'Name' stays the person
        // (roster-fed). Suggestion lists for 'Funktion' come from the deployment config, not code.
        'FW Offizier': { fields: ['Funktion', 'Name'] },
        'VKF Kontrollposten': { fields: ['Bedienung'] },
        'FKS Beobachtungsposten': { fields: ['Bedienung'] },
        'VKF Informationszentrum': { fields: ['Bedienung'] },
        'VKF Bereich Materialdepot': {},
        'FW Absperrung': { controls: ['rotation'], fields: ['Bedienung'] },
        'VKF Verkehrssperre ueberwacht': { controls: ['rotation'], fields: ['Bedienung'] },
        // ── Fahrzeuge / Mittel ── operator-named; directional ones rotate. The driven vehicles
        // (generic Fahrzeug, Drehleiter, Hubretter, Grosslüfter, Boot) also carry a Fahrer roster picker
        // and the «Herkunft» (originField) after it, and NO Bedienung; every other device here
        // carries «Bedienung» (14.09.) as its last field.
        // Drehleiter: composite body + independently-slewing ladder — `rotation` aims the truck,
        // `rotation2` aims the ladder (own rotor + Drehung stepper). Synthesised like the Grosslüfter
        // (see lib/symbolRender COMPOSITES).
        'VKF Drehleiter': { controls: ['rotation', 'rotation2'], fields: ['Fahrer', 'Herkunft'] },
        // Hubretter: the truck body rotates on its own (`rotation` — normal rotor + Drehung stepper),
        // INDEPENDENT of the articulated boom, which is shaped by dragging the cage tip (a separate
        // on-canvas handle sets the boom bearing `rotation2` + reach `reachM`/`reachN`). Rotating the
        // truck doesn't move the boom and vice-versa. See MapMarkers / Whiteboard cage handle +
        // lib/symbolRender HubretterBoom.
        'VKF Hubretter': { controls: ['rotation'], fields: ['Fahrer', 'Herkunft'] },
        // Drohne: a hovering-asset marker — stays upright (no rotation), no fields.
        'VKF Drohne': { fields: ['Bedienung'] },
        // generic vehicle: user-named (see lib/symbols) — title + a Fahrer picker; type lists via config
        'VKF Fahrzeug': { controls: ['rotation'], fields: ['Fahrer', 'Herkunft'] },
        'VKF Pumpe Typ2': { fields: ['Bedienung'] },
        // ⚠️ The kit below carries a STOREY (11.08.). A Lüfter, ein Exhauster, eine Tauchpumpe,
        // ein Handlöscher and ein Innenhydrant are placed INSIDE a building as often as outside
        // one — cellar work and stairwell ventilation are the normal case — and the storey was
        // the one thing the symbol could not say. The VEHICLES above deliberately keep none: a
        // Drehleiter stands in the street, and a control that is always empty is worse than none.
        'FW Tauchpumpe': { controls: ['floor'], fields: ['Bedienung'] },
        'FW Wassersauger': { controls: ['floor'], fields: ['Bedienung'] },
        'VKF Helilandeplatz': {},
        'VKF Luefter mobil': { controls: ['rotation', 'airflow', 'floor'], fields: ['Typ', 'Bedienung'] },
        // composite vehicle-mounted Grosslüfter: body heading (rotation) + fan aim (rotation2),
        // each with its own on-canvas rotor + Drehung stepper, PLUS the Lüfter airflow direction
        // (Einblasen / Absaugen — reverses the fan glyph, same as the mobile Lüfter). Synthesised
        // in lib/useSymbols.
        'Grosslüfter': { controls: ['rotation', 'rotation2', 'airflow', 'floor'], fields: ['Fahrer', 'Herkunft'] },
        'FW Entrauchung': { controls: ['rotation', 'floor'], fields: ['Bedienung'] },
        'FW Kleinloeschgeraet': { controls: ['floor'], fields: ['Typ', 'Bedienung'] },
        'FW Boot': { controls: ['rotation'], fields: ['Fahrer', 'Herkunft'] },
        'FW Sprungretter': { fields: ['Bedienung'] },
        'FW Leiter': { controls: ['rotation'], fields: ['Bedienung'] },
        // ── Wasser ── fixed supply points; the symbol is the info.
        'SI Ueberflurhydrant': {},
        'SI Unterflurhydrant': {},
        'VKF Innenhydrant': { controls: ['floor'] },
        'SI Wasserloeschposten': { controls: ['floor'] },
        'WV Loeschweier': { fields: ['Kapazität'] },
        'SI Wasserbezugsort': { fields: ['Kapazität'] },
        'SI Wasserdruckversorgung': {},
        // ── Gebäude ── interior elements: floor badge; walls/doors/stairs also orient.
        // The fire-rated walls (F30/F60/F180) are a Brandabschnitt boundary, drawn once for the
        // storeys it separates — von/bis (03.09.), same reasoning as stairs/lift below.
        'GB BA Wand F30': { controls: ['rotation', 'floorRange'] },
        'GB BA Wand F60': { controls: ['rotation', 'floorRange'] },
        'GB BA Wand F180': { controls: ['rotation', 'floorRange'] },
        'GB Ture BS R30': { controls: ['rotation', 'floor'] },
        'GB Ture Durchgang': { controls: ['rotation', 'floor'] },
        // stairs & lift span storeys → a von/bis range badge (e.g. -1/+3) instead of a single floor badge
        'GB Treppe 8': { controls: ['rotation', 'floorRange'] },
        'GB Lift': { controls: ['floorRange'] },
        // Kamin/Abzug run the full height of a building, like the shaft they mark — von/bis (03.09.).
        'GB Kamin': { controls: ['floorRange'] },
        'GB Abzug': { controls: ['rotation', 'floorRange'] },
        'SI Schieber': { controls: ['floor'], fields: ['Status'] },   // auf/zu
        'GB Elektrotableau': { controls: ['floor'] },
        'GB Sprinklerzentrale': { controls: ['floor'] },
        // BMA: the tripped Meldergruppe/Melder read off the BMZ display — one free row
        // (e.g. «12/3»), captioned under the glyph so the whole KP sees which one went off
        'GB Brandmeldezentrale': { controls: ['floor'], fields: ['Melder-Nr.'] },
        'GB BMA Melder': { controls: ['floor'], fields: ['Melder-Nr.'] },
        // ── Wand-Piktogramme (02.09.): the placard itself, not the schematic anlage icon above —
        // a Kroki can carry both, e.g. the BMZ cabinet AND the red plate pointing to it. Floor
        // only; unlike the two above there is nothing variable to read off a placard.
        'GB BMA-Z': { controls: ['floor'] },
        'GB RWA-BS': { controls: ['floor'] },
        'GB Fernsignaltableau': { controls: ['floor'] },
        'GB Schluesseldepot': { controls: ['floor'] },
        // ── Karte ── pure orientation glyphs.
        'SI Nordpfeil': { controls: ['rotation'] },
        'SI Windrichtung': { controls: ['rotation'] },
        // ── Partner ── labelled zones, each with a fixed Einheit dropdown (tune the lists above).
        'VKF Bereich Polizei': { fields: ['Einheit'] },
        'VKF Bereich Chemiewehr': {},
        'VKF Bereich Zivilschutz': {},
        'VKF Bereich Feuerwehr': { fields: ['Einheit'] },
      } as Record<string, SymbolPreset>,
      // category fallback for any future symbol not listed above — keep it lean
      byCat: {
        'Schadenlage': { controls: ['floor'] },
        'Gefahren': { controls: ['floor'] },
        'Gebäude': { controls: ['floor'] },
        'Wasser': {},
        'Führung': {},
        'Personen / Sanität': {},
        'Partner': {},
      } as Record<string, SymbolPreset>,
    },
    /** Global default for on-canvas symbol captions (device pref `prefs.symbolCaptions`
     *  overrides per device; a single symbol's `caption` overrides per object). 'auto'
     *  shows each symbol's one discriminating value so an operator reads it without opening
     *  the dashboard — the 3am "recognition over recall" rule. */
    captionDefault: 'auto',
  },
  /** ERG Schutzabstand rings around a Gefahrentafel (lib/ergRings): the isolation circle in the
   *  Absperrkreis red, the protective distance as a dashed amber planning line. */
  ergRings: {
    isolationColor: '#e8392b',
    protectColor: '#e2920a',
    isolationFillOpacity: 0.12,
    /** a placard marked «Gelöscht / erledigt» (lib/objectDone) keeps its rings, GREY and unfilled —
     *  the same «over, but it happened» the glyph says; a red wash would still order an evacuation */
    doneColor: '#8a929e',
  },
  drawing: {
    colors: ['#1f6feb', '#e8392b', '#1f9d57', '#e2920a', '#1b2330', '#ffffff'],
    widths: [3, 5, 8],
    defaultColor: '#1f6feb',
    /** Gefahrenradius / Absperrkreis defaults — red hazard ring, dashed, with a sensible
     *  starting radius and ± step (metres). Min radius guards against a stray tap. */
    circleColor: '#e8392b',
    /** stroke width of the cordon ring — slim, matching the live drag preview, so the
     *  committed circle isn't a heavy 4px band (the shared draw default). */
    circleLineWidth: 2,
    circleMinRadiusM: 5,
    circleRadiusStepM: 1,
    /** radius a freshly-placed Absperrkreis starts at — a visible default so a tap (no
     *  drag) still drops a real circle the user can then resize, rather than nothing. */
    circleInitialRadiusM: 25,
    /** default fill transparency of a new circle, and the presets offered in the editor. */
    circleFillOpacity: 0.12,
    /** The same two guards on a PLAN, in plan-width fractions (types · BoardAnno.radiusN): a Kroki
     *  has no metric scale until it is calibrated, so an Absperrkreis is sized against the sheet
     *  the way every other plan object is (lib/shapes · SHAPE_MIN_N, SHAPE_DEFS.defaultSizeN). */
    circleMinRadiusN: 0.01,
    circleInitialRadiusN: 0.08,
    fillOpacities: [0, 0.12, 0.25, 0.4],
    /** nominal hose length (m) for the Messpfeil distance helper "~N Schläuche" */
    hoseLengthM: 20,
    /** reserve margin added to a measured run before dividing into hose lengths (10 %) */
    hoseReservePct: 0.1,
    /** Plan-Maßstab calibration: the reference length (m) the −/+ stepper pre-fills. Most plans
     *  carry similar scale bars, so the LAST-used length is remembered and pre-filled from here. */
    planScaleDefaultM: 10,
    /** quick-pick reference lengths offered next to the stepper (the common scale-bar values) */
    planScaleDefaultsM: [50, 100],
    /** ± step (m) of the Massstab-festlegen stepper */
    planScaleStepM: 1,
    /** Line-tool presets: the single "Linie" tool draws a line; its style is then set
     *  (post-pick) via these presets in the DrawEditor. A preset is a bundle of `Drawing`
     *  defaults applied to the line; 'freihand' is the neutral line (clears arrow/marker/
     *  distance, keeps the freehand colour/width/dash). Each preset sets EVERY field it owns
     *  so switching back to Freihand cleanly removes the extras. The last-used preset is
     *  remembered, so a new line inherits it. */
    linePresets: [
      { id: 'freihand', label: 'Freihand', defaults: { arrow: false, marker: '', showDistance: false } },
      { id: 'pfeil', label: 'Pfeil', defaults: { arrow: true, marker: '', showDistance: false, dashed: false } },
      { id: 'rettungsachse', label: 'Rettungsachse', defaults: { arrow: true, marker: 'R', showDistance: false, dashed: true } },
    ] as { id: string; label: string; defaults: { arrow?: boolean; marker?: string; showDistance?: boolean; dashed?: boolean; color?: string } }[],
    /** subtle ink casing under a selected drawing — markers/symbols instead pop on select */
    selectColor: '#1b2330',
    /** how long a «zeigen» outline stays on the drawing it points at (ms). Long enough to find
     *  after the camera settles, short enough that it can't be mistaken for a selection. */
    flashMs: 2600,
    /** Halo colours for a hose line whose Atemschutz-Trupp is due / überfällig. MapLibre paint
     *  can't read CSS custom properties, so these mirror the --amber / --red tokens as literals
     *  (same values app.css defines); the DOM-side tag uses the tokens themselves. */
    atemschutzTone: { warn: '#e2920a', crit: '#e8392b' },
    /** distinct, well-separated accent colours assigned to teams (cycled by creation
     *  order). Kept apart from the draw `colors` so adding team hues never changes the
     *  ink palette. Each is legible on white and against the others on a busy plan. */
    teamColors: ['#1f6feb', '#e8392b', '#1f9d57', '#e2920a', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#b45309', '#475569'],
  },
  // Atemschutzüberwachung (SCBA breathing-apparatus monitoring) defaults — Swiss FKS/CSSP
  // contact-timer model. The 5-min contact interval (+1 min Nachfrist before the hard alarm)
  // was confirmed as the standard 2026-07-02; `alarmBar` (100) was confirmed 2026-07-27 by the
  // Atemschutz-Verantwortlicher, together with the decision that ONE pressure threshold is
  // enough – the older second «Mindestdruck» tier (60) was dropped in the same pass.
  // Deployment-overridable numbers resolve through `atemschutzDoctrine()` in
  // lib/deploymentConfig – don't read them from here directly.
  atemschutz: {
    /** pressure stepper: ± step and ceiling (320 allows an overfull cylinder) */
    pressureStep: 10,
    pressureMax: 320,
    /** Eingangsdruck the wizard starts on (6.8 L / 300 bar cylinder in service) */
    defaultPressureBar: 300,
    /** the lowest Eingangsdruck taken without a question (24.09.2026, Übung 23.09.: 60 and 180 bar
     *  went through as entries). Below it, registering, re-entering on a new cylinder or correcting
     *  asks ONCE, with the value on the button (components/TruppForm). No upper bound on
     *  purpose. 0 switches the question off. */
    entryPressureMin: 270,
    /** Alarmdruck (bar) – at or below it the Trupp turns back, and the card says so on the
     *  logged Druck AND on the expected-pressure Schätzung. The single pressure threshold there
     *  is; 0 switches it off. Visual only: it never touches the contact-clock alarm, which
     *  stays the one audible signal. */
    alarmBar: 100,
    /** …and the line a Trupp in RÜCKZUG is held to. Lower on purpose: the order to come back has
     *  been given, so the card would otherwise warn for the whole walk out — and a warning that
     *  runs for ten minutes is one nobody looks at. Below this one it speaks up again, which is a
     *  crew taking too long to get out. Set it to `alarmBar` to switch the distinction off. */
    alarmBarRueckzug: 50,
    /** contact interval (min): amber "Kontakt fällig" from this mark (FKS-Standard: 5) */
    contactIntervalMin: 5,
    /** Nachfrist (sec) on top of the interval before the hard überfällig alarm fires */
    contactGraceSec: 60,
    /** opt-in soft pip when a Trupp crosses into the amber «Kontakt fällig» lead (default OFF —
     *  the überfällig alarm stays the only mandatory tone; stations that want an early audible
     *  nudge set this true). Muted/demo suppress it like the main alarm. */
    contactDueChime: false,
    /** default Funkkanal a new Trupp is seeded with (FKS-Standard: 11) */
    defaultFunkkanal: 11,
    /** Funkkanal stepper range offered in settings. Handfunk is 1–99, but digital/relay
     *  schemes number channels far higher, so the ceiling is generous — the field is really a
     *  free channel number, not a fixed FKS 1–99 dial. */
    funkkanalMin: 1,
    funkkanalMax: 9999,
    /** SCBA cylinder volume (L) and assumed air consumption (L/min) used only as the initial
     *  expected-pressure fallback until confirmed pressure history provides a measured rate.
     *  A Schätzung only — kept out of alarm math; it never replaces a real reading. */
    cylinderLiters: 7,
    estConsumptionLPerMin: 50,
    /** Auftrag types offered to a Trupp UNDER Atemschutz (FKS); the actual order + location
     *  go in `ziel`. ⚠️ One of TWO lists — see `auftragEinfach` below and types · TruppAuftrag;
     *  anything resolving a stored id back to a label has to search both. */
    auftrag: [
      { id: 'retten', label: 'Retten' },
      { id: 'loeschen', label: 'Löschen' },
      { id: 'absuchen', label: 'Absuchen' },
      { id: 'sichern', label: 'Sichern' },
      { id: 'erkunden', label: 'Erkunden' },
      { id: 'anderes', label: 'Anderes' },
    ] as { id: AtemschutzAuftrag; label: string }[],
    /** …and the list for a Trupp OHNE Atemschutz (types · TruppKind `einfach`): the jobs a plain
     *  work squad is actually given. Its own list because the PA vocabulary is wrong on those
     *  cards — a Verkehrstrupp was being offered «Löschen».
     *  ⚠️ `sichern` and `anderes` are the SAME ids as above, not copies: they mean the same
     *  thing for both kinds, so a stored value keeps meaning what it meant. */
    auftragEinfach: [
      { id: 'verkehr', label: 'Verkehr' },
      { id: 'sanitaet', label: 'Sanität' },
      { id: 'wasser', label: 'Wasserversorgung' },
      { id: 'sichern', label: 'Sichern' },
      { id: 'bereitstellung', label: 'Bereitstellung' },
      { id: 'anderes', label: 'Anderes' },
    ] as { id: EinfachAuftrag; label: string }[],
    /** Ausrüstung a Trupp can take in (types · Trupp.equipment), as short labels — they print on
     *  the card and the Rapport. National default; a station lists its own as `doctrine.equipment`
     *  and reads it through `atemschutzEquipment()` in lib/deploymentConfig, never from here. The
     *  three defaults localise through copy · atemschutz.equipmentLabels. */
    equipment: [
      { id: 'retthaube', label: 'Retthaube' },
      { id: 'wbk', label: 'WBK' },
      { id: 'multiwarn', label: 'Multiwarn' },
    ] as { id: string; label: string }[],
  },
  // Mittel (material-use) catalogue defaults. A deployment overrides `catalogue`/`sources` via
  // its station config (DeploymentMittel); these national defaults give a usable picker out of
  // the box — empty catalogue (place-don't-configure: everything can be typed as «Anderes
  // Mittel»), plus the common Swiss FW units offered for custom entries.
  mittel: {
    catalogue: [] as { id: string; label: string; unit?: string; category?: string; stock?: { source: string; qty: number }[]; symbol?: string; verbrauchbar?: boolean }[],
    sources: [] as { id: string; label: string }[],
    units: ['Stk.', 'l', 'm', 'Sack', 'Flasche', 'kg', 'Rolle', 'Paar', 'h'] as string[],
    /** What a catalogue entry that names no unit is counted in. ⚠️ It is «Stk.» WITH the dot —
     *  it is an abbreviation of «Stück», and the same sheet printing «2 Stk.» on one line and
     *  «1 Stk» on the next reads as two different units. Five call sites each carried their own
     *  `|| 'Stk'` literal and all five had lost the dot; this is the one they read now. */
    defaultUnit: 'Stk.',
  },
  /** Schichtenplanung (the Zeitplan surface) */
  shifts: {
    /** length a freshly added availability block opens on — one watch, correctable in two taps */
    defaultHours: 8,
    /** How far AHEAD the planning surfaces let you reach (Schicht anlegen, a person's
     *  Verfügbarkeit, a Schichten column). Planning is about time that has not happened yet —
     *  the day wheel used to stop at «now», or at whatever was already planned, so somebody
     *  who is free the day after tomorrow simply could not be entered. Matches the Zeitplan's
     *  longest Zeitraum (168 h), so what can be planned is what can be looked at.
     *  Anwesenheit is deliberately NOT included: you cannot have arrived in the future. */
    planAheadHours: 168,
  },
} as const

/**
 * Every Auftrag type that exists, both kinds, each id ONCE (the two lists share `sichern` and
 * `anderes`), PA order first.
 *
 * ⚠️ This is what anything reading a STORED value has to go through — the label resolution
 * (lib/report · truppAuftragLabel) and the station's colour-per-Auftrag picker. Only the form
 * itself picks a single list, by the Trupp's kind; every other surface must still render an id
 * from the other list, because an incident is a legal record and Trupps predating the split
 * carry PA ids regardless of what they were.
 */
export const allAuftragTypes: { id: AtemschutzAuftrag | EinfachAuftrag; label: string }[] = [
  ...base.atemschutz.auftrag,
  ...base.atemschutz.auftragEinfach.filter((e) => !base.atemschutz.auftrag.some((p) => p.id === e.id)),
]

// `copy` is sourced from the active locale (see ./copy): `appConfig.copy.*` resolves
// the user's language at read time via the getter below. The rest of `appConfig` is the
// static, language-independent config (`base`, frozen `as const`). Locale is resolved at
// boot (device pref → deployment config → de-CH) by copy/applyLocale() in main.tsx; the
// getter then returns the resolved catalogue, so every `appConfig.copy.x` site is localized.
export const appConfig = {
  ...base,
  get copy(): Copy { return getCopy() },
} as typeof base & { readonly copy: Copy }
