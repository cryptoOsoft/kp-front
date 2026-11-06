import { useEffect, useState } from 'react'
import { appConfig } from '../config/appConfig'
import { fmtMMSS } from '../lib/format'
import { useHoldEntry } from '../lib/useHoldEntry'
import { HoldChargeRing, HoldTargets } from './HoldTargets'
import { EntryGlyph } from '../lib/icons'
import { useGeorefMode } from '../lib/georefMode'
import { tut } from '../lib/tutorials/anchors'

// Mobile field-capture FAB. Same tap / long-hold gesture as the TopBar "Eintrag": tap opens
// the composer, hold offers Sprachnotiz · Foto, tap-while-recording stops it. The hold acts on
// RELEASE — two targets rise above the circle and the finger slides onto one; release without
// moving and you get the voice memo (see lib/useHoldEntry).
export function FabEntry({ recording, recStartedAt, onTap, onHoldStart, onHoldStop, onHoldPhoto }: {
  recording: boolean
  recStartedAt: number | null
  onTap: () => void
  onHoldStart: () => void
  onHoldStop: () => void
  onHoldPhoto?: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [recording])
  const recSec = recording && recStartedAt ? Math.max(0, Math.round((now - recStartedAt) / 1000)) : 0
  const { pressing, pressedSince, latched, anchor, pick, handlers } = useHoldEntry({ recording, onTap, onHoldStart, onHoldStop, onHoldPhoto })
  // ⚠️ Gone while «Karte verknüpfen» is armed. On a phone the mode's bar takes the foot of the
  // screen and this circle floats ON its right end, over «Deckung prüfen» / «Fertig» — a button
  // that opens the journal, parked on top of the two that finish what you are doing. The
  // subscription lives HERE rather than in the shell, so one small component re-renders per
  // tap instead of the whole workspace.
  const georefArmed = !!useGeorefMode().planId

  // ⚠️ There is deliberately NO scroll-triggered «quiet» mode any more (18.09.2026): the circle
  // used to shrink and half-fade while anything under it was scrolled, which on the Journal was
  // most of the time. One size, one opacity, always — it is the only way to log from the field
  // on a phone, and a control that keeps changing shape cannot be aimed at without looking.

  if (georefArmed) return null

  return (
    <button
      className={`fab-entry ${recording ? 'rec' : ''} ${latched ? 'cancelling' : ''}`}
      style={latched && anchor ? { width: anchor.width } : undefined}
      aria-label={recording ? appConfig.copy.journal.recordStop : appConfig.copy.journal.add}
      title={recording ? appConfig.copy.journal.recordStop : appConfig.copy.journal.addHint}
      data-hold-target="cancel"
      {...tut('fab.entry')}
      {...handlers}
    >
      {latched && <HoldTargets placement="above" anchor={anchor} onPick={pick} />}
      {recording
        ? <><span className="tb-stop" /><span className="tb-act-label">{fmtMMSS(recSec)}</span></>
        : <>
          {/* ring around the Eintrag glyph, same as the TopBar Eintrag — never over the label */}
          <span className="tb-act-ic">
            {/* ⚠️ The glyph is an INLINE path, not a sprite <use> (29.08.). This button was seen in
                the field as a bare dark circle — glyph missing. A `<use href>` depends on the
                IconSprite's symbol being resolvable in the live document, and WebKit is flaky
                about re-resolving <use> targets across remounts (the FAB itself mounts and
                unmounts with every composer/panel open, and several sprites coexist). The one
                control that logs from the field must not be able to render empty, so it carries
                its own path (lib/icons · EntryGlyph). Since 29.09.2026 it is the journal glyph,
                not «+»: «+» is the tool bar's Hinzufügen, 60px below (sweep K2). */}
            <EntryGlyph />
            {pressing && pressedSince != null && <HoldChargeRing since={pressedSince} />}
          </span>
          <span className="tb-act-label">{appConfig.copy.journal.add}</span>
        </>}
    </button>
  )
}
