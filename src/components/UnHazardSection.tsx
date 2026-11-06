import { Icon } from '../lib/icons'
import { cx } from '../lib/cx'
import { appConfig } from '../config/appConfig'
import { decodeKemler, lookupUN, substanceName, type UnHazardEntry } from '../lib/unHazard'
import { getLocaleId } from '../config/copy'
import { ergVersionLabel, lookupErg, type ErgEntry } from '../lib/erg'
import { useHazardData } from '../lib/useHazardData'
import { ergDayNote, parseErgDistance, type ErgRingMode } from '../lib/ergRings'
import { Segmented } from './Segmented'
import { DoneChip } from './DoneChip'
import { isErgAdopted } from '../lib/ergAdopt'

/**
 * The ADR/ERG readout for one UN number (offline, bundled): what the Gefahrnummer means, the ADR
 * classification, the ERG guide with its isolation/protective distances, the source line and the
 * two look-up links. ONE block for both places that ask: a Gefahrentafel's detail panel
 * (ContextPanel, rings around the placed symbol) and the Gefahrgut lookup of «Karte & Objekte»
 * (components/karte, rings that are only looked at and never stored). Each caller owns what the
 * ring switch and «Absperrkreis übernehmen» DO — absent props draw no switch and no button; a
 * `ringMode` without `onRingMode` (a locked panel) is the switch's read-out.
 * `nameHero` puts the substance's ADR name first, as the card's hero line (owner, review round 4:
 * «for the gefahrgut stuff we also need to know the name») — the Karte's lookup asks for it; a
 * Gefahrentafel already shows the name in its own «Stoff» field, so it does not.
 *
 * The readout is NOT a table (owner, review round 7, mock B «Kachelraster»): the Stoff reads as a
 * hero line, the key figures as tiles in a 2-column grid, and the Stoff's bullet points sit at the
 * very bottom, above the source line and the two links. Every figure says its WORDS first and
 * keeps its code in brackets behind them («Entzündbare flüssige Stoffe (3)»); a figure that is
 * only a number (Gefahrnummer 33, ERG-Leitfaden 128) stays bare. The ERG distances keep their
 * key/value rows: each carries «Absperrkreis übernehmen», which a tile has no room for.
 */
export function UnHazardSection({ un, ringMode, onRingMode, ergCoord, onAdoptRadius, adoptedRadii = [], nameHero = false }: {
  un: string
  /** the substance's name as the card's hero line (lib/unHazard · substanceName) */
  nameHero?: boolean
  /** the ring switch's value — absent ⇒ no switch; without `onRingMode` it is a read-out */
  ringMode?: ErgRingMode
  onRingMode?: (mode: ErgRingMode) => void
  /** where the rings stand, for the day/night note (lib/ergRings · ergDayNote) */
  ergCoord?: [number, number]
  /** «Absperrkreis übernehmen» beside each distance — absent ⇒ no button */
  onAdoptRadius?: (metres: number) => void
  /** the radii already standing as an Absperrkreis around this placard (lib/ergAdopt): their row
   *  shows ✓ instead of the button – a one-time action's done state, read off the Karte */
  adoptedRadii?: readonly number[]
}) {
  // read per-render (not module-load) so the resolved locale is applied — see config/copy
  const C = appConfig.copy.contextPanel
  // repaint when the fetched hazard datasets land (lib/useHazardData)
  useHazardData()
  // live ADR hazard readout — derived from the current UN-Nr row, so it updates as you
  // type. Only present when this symbol carries a UN-Nr field with a value.
  const unValue = un.trim()
  const unHit: UnHazardEntry | null = unValue ? lookupUN(unValue) : null
  // Every code carries its meaning («Giftige Stoffe (6.1)») — the readout has to explain
  // itself at 3am, and the bare number only speaks to somebody who trains ADR (Feldtest
  // 07.09.). WORDS FIRST, the code in brackets behind them (owner, review round 7): the tile is
  // read as a sentence and the code only confirms it. A code we have no word for stays bare.
  // The Gefahrnummer stays bare too: the Kemler bullets at the foot decode it in full.
  const adrMeaning = (code: string) => {
    const m = C.adrMeanings[code]
    return m ? `${m} (${code})` : code
  }
  const name = nameHero ? substanceName(unHit, getLocaleId()) : null
  const showUnHazard = unValue.length > 0
  const kemler = decodeKemler(unHit?.hazardNumber)
  // The transcribed ERG yellow pages carry the class-1 explosives without id numbers, so they
  // compile away (tools/gen_erg.py) and a Gefahrentafel with e.g. UN 0027 showed no guide at all
  // (Feldtest 08.09., «hier ohne Details»). The printed rule is deterministic — every class 1 is
  // guide 112, division 1.4 is 114 — so the guide is synthesized from the ADR classification.
  // Explosives have no Table-1 rows, so no distances are being withheld by this.
  const ergDirect = showUnHazard ? lookupErg(unValue) : null
  const erg: ErgEntry | null = ergDirect
    ?? (showUnHazard && unHit?.class === '1'
      ? { g: unHit.classificationCode?.startsWith('1.4') ? 114 : 112 }
      : null)
  /* The key figures as tiles, in the order the owner reads them: what it IS, the Gefahrnummer,
     the Gefahrzettel, the Verpackungsgruppe, then the ERG guide. `numeric` keeps the pure numbers
     in the mono face — they are codes to compare, not words to read. An empty figure is dropped:
     the grid shows what we know, not what we could have known. */
  const hazTiles: { k: string; v: string; numeric?: boolean }[] = [
    ...(unHit
      ? [
          { k: C.unClass, v: unHit.class ? adrMeaning(unHit.class) : '' },
          { k: C.unKemler, v: unHit.hazardNumber ?? '', numeric: true },
          { k: C.unLabels, v: unHit.hazardLabels.map(adrMeaning).join(', ') },
          {
            k: C.unPacking,
            v: unHit.packingGroup
              ? (C.packingGroups[unHit.packingGroup]
                ? `${C.packingGroups[unHit.packingGroup]} (${unHit.packingGroup})`
                : unHit.packingGroup)
              : '',
          },
        ]
      : []),
    ...(erg?.g != null ? [{ k: C.ergGuide, v: `${erg.g}${erg.p ? ' P' : ''}`, numeric: true }] : []),
  ].filter((t) => t.v)
  const unLookupHref = C.unLookupUrl
    .replace('{un}', encodeURIComponent(unValue))
    .replace('{name}', encodeURIComponent(unHit?.name_de ?? ''))
  if (!showUnHazard) return null
  return (
    <div className="ctx-section un-haz">
      <span className="ctx-section-label">{C.unHazardTitle}</span>
      {/* the name first and in the card's biggest words: what the number IS, before what it does.
          The «Stoff» label it used to carry stays for the screen reader — the eye reads the hero
          under «Gefahrgut (ADR)» and needs no word for it, an ear does. */}
      {name && <p className="un-haz-hero"><span className="sr-only">{C.unSubstance}: </span>{name}</p>}
      {/* the tactical hazard read from the Gefahrnummer: water reactivity first — can we
          extinguish? That is a WARNING, not a figure, so it keeps the top while the rest of the
          Kemler reading moves to the foot of the card. */}
      {kemler?.reactsWithWater && (
        <p className="un-haz-water"><Icon id="warn" /> {C.unWater}</p>
      )}
      {!unHit && <p className="un-haz-none">{C.unNoMatch}</p>}
      {hazTiles.length > 0 && (
        <div className="un-haz-tiles">
          {hazTiles.map((t) => (
            <div className={cx('un-haz-tile', t.numeric && 'num')} key={t.k}>
              <span className="un-haz-tile-k">{t.k}</span>
              <span className="un-haz-tile-v">{t.v}</span>
            </div>
          ))}
        </div>
      )}

      {/* ERG response block (offline, bundled): TIH isolation/protective distances and the
          polymerization flag — labelled Planungshilfe, with its source at the foot of the card.
          The guide NUMBER stands in the tile grid above, so a guide that carries neither
          distances nor a polymerization warning draws no block at all (it would be an empty box
          under a dashed hairline). */}
      {erg && (!!erg.p || !!erg.tih?.length) && (
        <div className="un-erg">
          {erg.p && <p className="un-haz-water"><Icon id="warn" /> {C.ergPolymerization}</p>}
          {(erg.tih ?? []).map((row, i) => {
            // «Absperrkreis übernehmen» beside each distance (Feldtest 07.09.): the value
            // becomes a real Absperrkreis around the symbol, one tap, no re-typing of
            // «0.2 km». ⚠️ Its OWN 44px button with the Absperrkreis tool's ⊙ (23.09.2026),
            // not a 12px underlined «Übernehmen» squeezed after the value — and not the
            // whole row either: touching the number to read it would then drop a circle on
            // the map. Icon-only, so the row keeps its width; the name is the hold-tooltip.
            const distRow = (label: string, value?: string) => {
              if (!value) return null
              const metres = parseErgDistance(value)
              return (
                <div className="un-haz-row">
                  <span className="un-haz-k">{label}</span>
                  <span className="un-haz-v">{value}</span>
                  {onAdoptRadius && metres != null && (isErgAdopted(adoptedRadii, metres)
                    // «30 m ✓ gesetzt»: the short word beside the value (the row has the 44px button's room), the
                    // full words as its name
                    ? <DoneChip className="un-erg-done" title={C.ergAdopted}>{C.ergAdoptedShort}</DoneChip>
                    : <button
                      type="button" className="un-erg-adopt"
                      aria-label={C.ergAdopt} title={C.ergAdopt}
                      onClick={() => onAdoptRadius(metres)}
                    ><Icon id="circle" /></button>
                  )}
                </div>
              )
            }
            return (
            <div className="un-erg-tih" key={i}>
              {row.n && <span className="un-erg-n">{row.n}</span>}
              {distRow(C.ergIsolate, row.si)}
              {distRow(C.ergProtectDay, row.pd)}
              {distRow(C.ergProtectNight, row.pn)}
              {row.l === 'T3'
                ? <div className="un-haz-row"><span className="un-haz-k">{C.ergLarge}</span><span className="un-haz-v">{C.ergTable3}</span></div>
                : row.l && (
                  <div className="un-haz-row">
                    <span className="un-haz-k">{C.ergLarge}</span>
                    <span className="un-haz-v">{[row.l.li, row.l.ld && `${C.ergDayShort} ${row.l.ld}`, row.l.ln && `${C.ergNightShort} ${row.l.ln}`].filter(Boolean).join(' · ')}</span>
                  </div>
                )}
            </div>
            )
          })}
          {/* Schutzabstand rings on the Karte (Feldtest Manuel, 07.09.): on by default
              («Klein»), because the distances above only help once they are geometry.
              «Gross» is offered only where the large-spill column holds numbers — on
              the 'T3' sentinel a circle would claim to know what only container and
              wind decide. The ergSource caveat above is the ring's caveat too. */}
          {ringMode && !!erg.tih?.length && (
            <div className="un-erg-rings">
              {/* …and which distance the ring draws, with the sun's reason: «Nacht ·
                  Sonnenuntergang 16:42» (B1, 08.10.2026 — it was a silent 07–19 h clock) */}
              <span className="un-haz-k">
                {C.ergRingsLabel}
                <span className="un-erg-day">{ergDayNote(new Date(), ergCoord)}</span>
              </span>
              {/* …and on a locked panel the answer alone, in the read-out recipe (RBAC audit
                  22.10.2026 — it was a live switch whose taps went nowhere) */}
              {onRingMode ? (
                <Segmented
                  ariaLabel={C.ergRingsLabel}
                  value={ringMode}
                  options={[
                    { value: 'off' as const, label: C.ergRingsOff },
                    { value: 'small' as const, label: C.ergRingsSmall },
                    { value: 'large' as const, label: C.ergRingsLarge, disabled: !erg.tih[0]?.l || erg.tih[0].l === 'T3' },
                  ]}
                  onChange={onRingMode}
                />
              ) : (
                <b className="kv-val-ro">{{ off: C.ergRingsOff, small: C.ergRingsSmall, large: C.ergRingsLarge }[ringMode]}</b>
              )}
            </div>
          )}
        </div>
      )}
      {/* the Stoff's own bullet points at the very bottom (owner, review round 7: «move the bullet
          points of the Stoff to the very bottom») — below the figures, above the source line and
          the two links. What the Gefahrnummer means in words, for whoever reads to the end. */}
      {kemler && kemler.hazards.length > 0 && (
        <ul className="un-haz-list">
          {kemler.hazards.map((h) => <li key={h}>{h}</li>)}
        </ul>
      )}
      {erg && <p className="un-erg-src">{C.ergSource.replace('{v}', ergVersionLabel())}</p>}
      <a className="un-haz-link" href={unLookupHref} target="_blank" rel="noopener noreferrer">
        <Icon id="eye" /> {C.unLookupLabel}
      </a>
      {erg && (
        <a className="un-haz-link" href={`https://cameochemicals.noaa.gov/unna/${encodeURIComponent(unValue.replace(/\D/g, ''))}`} target="_blank" rel="noopener noreferrer">
          <Icon id="eye" /> {C.ergCameoLabel}
        </a>
      )}
    </div>
  )
}
