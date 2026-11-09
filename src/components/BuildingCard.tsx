import { useState } from 'react'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { Icon } from '../lib/icons'
import type { BuildingInfo } from '../lib/api/building'
import { buildingChips, buildingSources, hasBuildingContent, noteLines, objectCaption, visitLine } from '../lib/buildingCard'
import { RegisterHintBody, RegisterHintButton, RegisterSection, StationNotes } from './BuildingFacts'
import s from './BuildingCard.module.css'

/**
 * «Gebäude» — the building at the Einsatzort (KP Front card F5). Opened from its chip on the Karte
 * and in the plan's chip row (BuildingFloat); `onClose` draws the card's ✕.
 *
 * Two steps, one heading style (owner, 27.10.2026: «a clear two-step thing: first
 * "Sofortmassnahmen" then "Gebäude"»): the Einsatzobjekt's Sofortmassnahmen and Bemerkungen when
 * the station wrote some (named only when they are a neighbour's, `objectCaption`), then «Gebäude»
 * – the hazard lines first (the warn glyph as the bullet), then the register facts, all one size
 * and weight – then the last Objektbesuch. No head row: the first heading carries the ✕, the
 * «Gebäude» heading «Register-Hinweis». The
 * pieces are the Karte panel's own (BuildingFacts), so the two surfaces cannot drift apart.
 * Nothing to say → nothing drawn (lib/buildingCard).
 *
 * «Register-Hinweis» stands FOLDED each time the card opens, as on the peacetime Karte panel
 * (KartePanel): the facts come first, where they come from is one tap away (Manuel 09.11.2026 –
 * open, the disclaimer stood between Sofortmassnahmen and the facts; it was open since sweep
 * 30.10.2026 #6). BuildingFloat mounts the card only while open, so every open starts here.
 */
export function BuildingCard({ info, onClose }: { info: BuildingInfo | null; onClose?: () => void }) {
  const [hint, setHint] = useState(false)
  if (!info || !hasBuildingContent(info)) return null
  const C = appConfig.copy.building
  const chips = buildingChips(info)
  // the hazards first inside «Gebäude», then the facts
  const lines = [...chips.filter((c) => c.hazard), ...chips.filter((c) => !c.hazard)]
  const sources = buildingSources(info)
  const measures = noteLines(info.object?.measures)
  const remarks = noteLines(info.object?.remarks)
  const notes = measures.length > 0 || remarks.length > 0
  const caption = notes ? objectCaption(info) : ''
  const visit = visitLine(info)
  // THE sheet ✕ (`.ip-x`, docs/ui-conventions · «The ✕ that closes a sheet»; r35, 06.11.2026 – it
  // was a bare 44px IconButton with a 20px glyph, the one ✕ without the grey plate)
  const close = onClose && (
    <button type="button" className={cx('ip-x', s.close)} onClick={onClose} aria-label={appConfig.copy.closeDialog} title={appConfig.copy.closeDialog}>
      <Icon id="close" />
    </button>
  )
  return (
    // No head row of its own (owner, 27.10.2026: an empty «Register-Hinweis ✕» row was wasted): the
    // FIRST section's heading carries the ✕ at its right end, and «Register-Hinweis» always sits on
    // the «Gebäude» heading's row, its body opening right under it. «Gebäude» stays the card's name.
    <section className={s.card} aria-label={C.title}>
      <StationNotes measures={measures} remarks={remarks} source={caption} end={close} />
      <RegisterSection title={C.title} chips={lines} className={notes ? s.facts : undefined}
        end={<>
          <RegisterHintButton className={cx(s.hint, s.hintBtn)} open={hint} onToggle={() => setHint((o) => !o)} />
          {!notes && close}
        </>}
        below={hint && <RegisterHintBody className={s.hintBody} textClassName={s.sources}>{sources && <div className={s.sources}>{sources}</div>}</RegisterHintBody>} />
      {/* neither section (a last Objektbesuch alone): the ✕ needs a row of its own */}
      {!notes && !lines.length && close && <div className={s.head}>{close}</div>}
      {visit && <p className={s.visit}><Icon id="clipboard" /><span>{visit}</span></p>}
    </section>
  )
}
