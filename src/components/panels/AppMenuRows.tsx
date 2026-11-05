// The app menu's rows — ONE component for the two places the menu hangs (owner, 17.10.2026):
// the Einsatz menu (IncidentSwitcher, under the active Einsatz's card) and home's «Einsätze ▾»
// sheet on «Karte & Objekte» (App · homeMenu, where there is no card because there is no Einsatz
// open). Same rows, same order, same classes, so the two can never drift apart again — the sheet
// used to be the old launcher card with big launch buttons, and the owner read it as a second app.
//
// What it renders, top to bottom: the «Einsätze» group (the running ones as rows, the alarms
// waiting to be taken, «Einsatz verlassen», «Alle Einsätze», «Einsatz eröffnen»), the «App» group
// (Objektbesuche, Einstellungen, the offline row, Üben, Hilfe, Installieren), who is signed in with
// «Abmelden», the build label and a waiting update. Every row is drawn only when its handler is
// handed in — a door the session cannot go through is not drawn (docs/roles-and-access.md) — and
// the callers decide whether a row closes the menu, so this file never needs to know.

import { useEffect, useState, type ReactNode } from 'react'
import { ShellLoader } from '../ShellLoader'
import { Icon } from '../../lib/icons'
import { initials, roleLabel, fillTemplate, fmtSpanShort } from '../../lib/format'
import { buildLabel } from '../../lib/buildInfo'
import { applyUpdateNow, onUpdateAvailable } from '../../lib/swUpdate'
import { canApplyInPlace } from '../../lib/updatePolicy'
import { getInstallPlatform } from '../../lib/installPrompt'
import { appConfig } from '../../config/appConfig'
import { shortAddress } from '../../lib/deploymentConfig'
import { runningOthers } from '../../lib/switcherLists'
import { loadKarteView } from '../../lib/karte/session'
import type { DiveraAlarm, IncidentMeta } from '../../lib/incidents'

export interface AppMenuAlarms {
  /** the alarms this device still shows (dismissals already filtered out) */
  list: DiveraAlarm[]
  /** divera_id mid-take: that row says «Öffne …», every take and × is locked meanwhile */
  taking: number | null
  onTake: (a: DiveraAlarm) => void
  /** hide it on THIS device only — never an archive of a live dispatch (lib/diveraDismiss) */
  onDismiss: (a: DiveraAlarm) => void
}

/** A menu row's word. It needs an element of its own for ONE reason: a row centres its children,
 *  and centring a line box is not the same as centring the letters in it (`.ip-menu-actlabel`,
 *  13-incident.css — owner, review 7: «feels like it's a little bit above center»). As a bare
 *  text node it was also an anonymous flex item, whose leading space the engine drops, so the
 *  `<Icon /> {label}` spacing was never the space it looked like — it was the row's `gap`. */
const ActLabel = ({ children }: { children: ReactNode }) => <span className="ip-menu-actlabel">{children}</span>

export function AppMenuRows({
  activeId, incidents, isEditor, user, opening = null, alarms, onSwitch, onLeave, onHistory, onCreate,
  onObjectVisits, onSettings, offline, onUeben, onHelp, onInstall, onLogout,
}: {
  /** the Einsatz the menu's card names (IncidentSwitcher); null on home's sheet, which has no card
   *  — so the Einsatz a «Karte & Objekte» covers is listed there as a row, the way back into it */
  activeId: string | null
  incidents: IncidentMeta[]
  isEditor: boolean
  user: { display_name: string; color: string | null; role: string }
  /** the Einsatz a human is opening right now: its row spins and every row locks (App · opening) */
  opening?: string | null
  /** home only — inside an Einsatz a fresh alarm reaches the operator through the banner */
  alarms?: AppMenuAlarms
  onSwitch: (i: IncidentMeta) => void
  /** «Einsatz verlassen» — to «Karte & Objekte», the Einsatz keeps running behind it. Only inside
   *  an Einsatz, never for a link session (App passes no `onOpenKarte` there). */
  onLeave?: () => void
  /** «Alle Einsätze» — absent for an Einsatz-Link session, which may only ever see its own */
  onHistory?: () => void
  /** «Einsatz eröffnen» — editors only */
  onCreate?: () => void
  onObjectVisits?: () => void
  onSettings?: () => void
  /** the device's offline row: «Offline-Bereitschaft» of the open Einsatz, or on home «Auf diesem
   *  Gerät» of «Karte & Objekte» — the same slot, the same glyph */
  offline?: { label: string; onOpen: () => void }
  /** «Üben» – the tutorials sheet (App · landingSheet 'ueben'); absent for a link session */
  onUeben?: () => void
  onHelp: () => void
  onInstall?: () => void
  onLogout?: () => void
}) {
  const cp = appConfig.copy.incidentSwitcher
  const cu = appConfig.copy.update
  const ci = appConfig.copy.intake
  const hasCard = activeId != null
  // A waiting build, and whether this device may take it in place (iOS wedges — updatePolicy).
  // `onUpdateAvailable` answers at once when a build is already waiting, so subscribing while the
  // menu is open is enough; it also flips the moment a deploy lands with the menu standing open.
  const [updateWaiting, setUpdateWaiting] = useState(false)
  const [applyingUpdate, setApplyingUpdate] = useState(false)
  useEffect(() => onUpdateAvailable(setUpdateWaiting), [])
  const updateReady = updateWaiting && canApplyInPlace(getInstallPlatform())
  // the laufende Zeit on each row — mounted only while the menu is open, so tick only then
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  // Only the RUNNING Einsätze are listed. Everything that is over lives behind «Alle Einsätze»,
  // where it can be searched and grouped — a handful of recent ones in the menu turned out to be
  // neither (feedback 2026-08-26): you either switch to something that is running, or you go
  // looking for a specific old Einsatz, and the second one is not a four-row list.
  const running = runningOthers(incidents, activeId)
  const alarmList = alarms?.list ?? []
  // where «Karte & Objekte» was left — the sub line of «Einsatz verlassen» (a sessionStorage read)
  const karteBack = onLeave ? loadKarteView()?.label ?? null : null
  // The Einsätze group is about moving BETWEEN Einsätze. When nothing in it can render — no other
  // incident, no alarm, no «Einsatz verlassen», no «Einsatz eröffnen», no «Alle Einsätze» — none of
  // it shows, which is what an Einsatz-Link sees: it is bound to one Einsatz and switching is
  // neither offered nor permitted. Derived rather than passed, so the menu never has to know why
  // the rows are missing.
  const showIncidents = running.length > 0 || alarmList.length > 0 || !!onLeave || !!onHistory || (isEditor && !!onCreate) || !hasCard
  const exerciseBadge = <span className="ip-badge ip-badge-exercise">{appConfig.copy.exerciseBadge}</span>
  return (
    <>
      {showIncidents && (
        <div className="ip-rows">
          {/* No label over the laufende rows under a card: they sit directly under the Einsatz
              they are the alternatives to. Without a card (home) there is no such context, so the
              group says what it is — and, with nothing running and nothing to take, says that in
              one quiet line (no intro paragraph: the rows below are what to do). */}
          {!hasCard && <div className="ip-menu-label">{cp.incidents}</div>}
          {!hasCard && running.length === 0 && alarmList.length === 0 && <div className="ip-menu-empty">{cp.noOpenIncidents}</div>}
          {running.map((i) => (
            <button key={i.id} type="button" className="ip-menu-row" disabled={opening != null} onClick={() => onSwitch(i)}>
              <span className="ip-menu-when">{opening === i.id ? <ShellLoader /> : fmtSpanShort(now - Date.parse(i.started_at))}</span>
              <span className="ip-menu-rowmain">
                <span className="ip-menu-titleline">
                  <span className="ip-menu-title">{i.title}</span>
                  {/* beside the title, not inside it: a long Einsatzname ellipsises, and the
                      marker that says «Übung» must not be the part that gets cut off */}
                  {i.is_exercise && exerciseBadge}
                </span>
                {/* WHERE it is, the way the card says it for the active Einsatz — «Ölspur» is
                    not an Einsatz you can tell apart from another «Ölspur» without it. Same
                    shortened form as everywhere else: the own Gemeinde is left off. */}
                {shortAddress(i.address) && <span className="ip-menu-rowsub">{shortAddress(i.address)}</span>}
              </span>
            </button>
          ))}
          {alarmList.map((a) => (
            // ⚠️ Take, or × to hide it on THIS device only (per-device, kp.divera.dismissed) — the
            // × NEVER archives a live dispatch for the crew (that would be a server delete). The
            // row's body is the take; both lock while any take runs.
            <div key={a.id} className="ip-menu-alarm">
              <button type="button" className="ip-menu-row" disabled={alarms!.taking != null} onClick={() => alarms!.onTake(a)}>
                <span className="ip-menu-when ip-menu-alarm-mark">{alarms!.taking === a.divera_id ? <ShellLoader /> : <Icon id="bell" />}</span>
                <span className="ip-menu-rowmain">
                  <span className="ip-menu-kicker">{ci.newDiveraAlarm}</span>
                  <span className="ip-menu-titleline"><span className="ip-menu-title">{a.title}</span></span>
                  <span className="ip-menu-rowsub">{shortAddress(a.address) ?? ci.addressUnknown}</span>
                </span>
                <span className="ip-menu-alarm-go">{alarms!.taking === a.divera_id ? ci.alarmOpening : ci.alarmOpen}</span>
              </button>
              <button type="button" className="ip-menu-alarm-x" aria-label={ci.dismiss} title={ci.dismiss}
                disabled={alarms!.taking != null} onClick={() => alarms!.onDismiss(a)}>
                <Icon id="close" />
              </button>
            </div>
          ))}
          {/* «Einsatz verlassen» (owner, 17.10.2026 — it was «Karte & Objekte» in the App group):
              it is about THIS Einsatz, so it heads the doors out of it. «verlassen» must never read
              as closing or archiving, so the sub line says the Einsatz runs on, and where the
              viewer picks up again (lib/karte/session · KarteView.label). The map glyph, not the
              Abmelden one: it says where you go. */}
          {onLeave && (
            <button type="button" className="ip-menu-act ip-menu-act-two" onClick={onLeave}>
              <Icon id="map" />
              <span className="ip-menu-rowmain">
                <span className="ip-menu-title">{appConfig.copy.karte.leave}</span>
                <span className="ip-menu-rowsub">{karteBack ? fillTemplate(appConfig.copy.karte.leaveBack, { where: karteBack }) : appConfig.copy.karte.leaveSub}</span>
              </span>
            </button>
          )}
          {/* History and creation are the two doors OUT of the running list. They are peers:
              one opens an earlier Einsatz, one opens a new one. */}
          {onHistory && (
            <button type="button" className="ip-menu-act" onClick={onHistory}>
              <Icon id="list" /><ActLabel>{cp.allIncidents}</ActLabel>
            </button>
          )}
          {isEditor && onCreate && <button type="button" className="ip-menu-act" onClick={onCreate}><Icon id="plus" /><ActLabel>{ci.titleNew}</ActLabel></button>}
        </div>
      )}
      {/* «App»: device + installation, not an Einsatz. It always has rows — Hilfe is
          unconditional — so the label never heads an empty group the way «Einsätze» can. */}
      <div className="ip-menu-label">{cp.app}</div>
      {/* Objektbesuche is no Einsatz, so it is not under «Einsätze»: it is the app's other job. */}
      {onObjectVisits && (
        <button type="button" className="ip-menu-act" onClick={onObjectVisits}>
          <Icon id="clipboard" /><ActLabel>{appConfig.copy.objectVisits.launcher}</ActLabel>
        </button>
      )}
      {onSettings && <button type="button" className="ip-menu-act" onClick={onSettings}><Icon id="gear" /><ActLabel>{appConfig.copy.settings.title}</ActLabel></button>}
      {offline && <button type="button" className="ip-menu-act" onClick={offline.onOpen}><Icon id="snapshot" /><ActLabel>{offline.label}</ActLabel></button>}
      {/* «Üben» right above the Hilfe it practises (owner, 05.11.2026: one row, both menus) */}
      {onUeben && <button type="button" className="ip-menu-act" onClick={onUeben}><Icon id="play" /><ActLabel>{appConfig.copy.tutorials.menu}</ActLabel></button>}
      <button type="button" className="ip-menu-act" onClick={onHelp}><Icon id="info" /><ActLabel>{appConfig.copy.help.menu}</ActLabel></button>
      {onInstall && <button type="button" className="ip-menu-act" onClick={onInstall}><Icon id="share-ios" /><ActLabel>{appConfig.copy.install.menu}</ActLabel></button>}
      {/* ONE hairline in this menu, above the identity row (22.09.2026): the small-caps label
          heads «App» on its own, but the row under the actions is not an action — it is who
          is signed in, and the rule is what says «the list ends here». */}
      <div className="ip-menu-sep" />
      <div className="ip-menu-user">
        <span className="ip-menu-av" style={{ background: user.color ?? 'var(--ink-faint)' }}>{initials(user.display_name)}</span>
        <span className="ip-menu-userinfo">
          <span className="ip-menu-username">{user.display_name}</span>
          <span className="ip-menu-userrole">{roleLabel(user.role)}</span>
        </span>
        {onLogout && <button type="button" className="ip-menu-logout" onClick={onLogout}><Icon id="logout" /> {cp.logout}</button>}
      </div>
      <div className="ip-menu-foot">
        {/* No manual "check for updates" — a fresh deploy surfaces itself (the 5-min poll and
            the visibility-resume check). What IS here is the apply, and only while a build is
            actually waiting: the menu is where somebody looks when an app feels stale, which
            is exactly the state a dismissed banner leaves behind (16.09.2026). */}
        <span className="ip-menu-ver" title={cp.appVersion}>{buildLabel()}</span>
        {updateReady && (
          <button type="button" className="ip-menu-update" disabled={applyingUpdate}
            onClick={() => { setApplyingUpdate(true); void applyUpdateNow() }}>
            {applyingUpdate ? <ShellLoader /> : <Icon id="rotate" />}
            {applyingUpdate ? cu.applying : cu.apply}
          </button>
        )}
      </div>
    </>
  )
}
