// The two «what now» menus of home, out of App (sweep A.7): the launcher card's body (a link
// session whose Einsatz could not be fetched still lands on it — lib/karte/home · appScreen) and
// the «Einsätze ▾» sheet on «Karte & Objekte». Both read one `HomeActions`, built in App.

import { appConfig } from '../config/appConfig'
import { alarmProviderName, shortAddress } from '../lib/deploymentConfig'
import { fillTemplate, initials, roleLabel } from '../lib/format'
import { buildLabel } from '../lib/buildInfo'
import { Icon } from '../lib/icons'
import type { DiveraAlarm, IncidentMeta } from '../lib/incidents'
import type { TroubleEvent } from '../lib/trouble'
import { ShellLoader } from './ShellLoader'
import { AppMenuRows, FeedbackPrompt } from './panels'

/** What both home menus show and do. The optional doors are absent where they do not exist
 *  (Objektbesuche off, already installed). */
export type HomeActions = {
  /** a recent trouble worth a Rückmeldung (lib/trouble); never offered to a link session */
  trouble: TroubleEvent | null
  onTrouble: (t: TroubleEvent) => void
  onTroubleDismiss: () => void
  linkScoped: boolean
  isEditor: boolean
  user: { display_name: string; color: string | null; role: string }
  incidents: IncidentMeta[]
  activeId: string | null
  /** the Einsatz being opened right now (its row shows the loader) */
  opening: string | null
  /** the alarms this device still shows (dismissals filtered out), and the one mid-take */
  alarms: DiveraAlarm[]
  taking: number | null
  onTake: (a: DiveraAlarm) => void
  onDismissAlarm: (a: DiveraAlarm) => void
  /** open an Einsatz — or step aside to the one already open behind the viewer */
  onOpenIncident: (i: IncidentMeta) => void
  onHistory: () => void
  onCreate: () => void
  onObjectVisits?: () => void
  onSettings: () => void
  /** «Üben» (the tutorials sheet); absent where this session may start none */
  onUeben?: () => void
  onHelp: () => void
  onInstall?: () => void
  onLogout: () => void
}

/** The launcher card's content: the open Einsätze to resume + the alarms to take, shown directly
 *  (no «Kein offener Einsatz» dead-end), with manual create always on. */
export function LauncherBody({
  trouble, onTrouble, onTroubleDismiss, linkScoped, isEditor, user, incidents, opening, alarms, taking, onTake,
  onDismissAlarm, onOpenIncident, onHistory, onCreate, onObjectVisits, onSettings, onHelp, onInstall, onLogout,
}: HomeActions) {
  const openIncidents = incidents.filter((i) => !i.is_archived)
  // the Alarmquelle's own name, or null where this station has none (deploymentConfig)
  const alarmProvider = alarmProviderName()
  // ⚠️ counted over the alarms that will ACTUALLY render (App · landingAlarms), dismissals included
  const hasLanding = openIncidents.length > 0 || alarms.length > 0
  return (
    <>
      {trouble && !linkScoped && (
        <FeedbackPrompt trouble={trouble} onOpen={() => onTrouble(trouble)} onDismiss={onTroubleDismiss} />
      )}
      {hasLanding ? (
        <div className="ip-launch-list">
          {openIncidents.map((i) => (
            <button key={i.id} type="button" className="ip-launch" disabled={opening != null} onClick={() => onOpenIncident(i)}>
              {opening === i.id ? <ShellLoader /> : <Icon id="flag" />}
              <span className="ip-launch-main">
                <span className="ip-launch-title">{i.title}</span>
                <span className="ip-launch-sub">{shortAddress(i.address) ?? ''}</span>
              </span>
              <Icon id="chevron" />
            </button>
          ))}
          {alarms.map((a) => (
            // the pool's ONLY surface now (the intake sheet is gone): take, or ×
            // to hide it on THIS device only (per-device, kp.divera.dismissed) — the ×
            // NEVER archives a live dispatch for the crew (that would be a server delete)
            <div key={a.id} className="ip-launch alarm">
              <button type="button" className="ip-launch-hit" disabled={taking != null} onClick={() => onTake(a)}>
                <span className="ip-launch-pulse">{taking === a.divera_id ? <ShellLoader /> : <Icon id="bell" />}</span>
                <span className="ip-launch-main">
                  <span className="ip-launch-kicker">{appConfig.copy.intake.newDiveraAlarm}</span>
                  <span className="ip-launch-title">{a.title}</span>
                  <span className="ip-launch-sub">{shortAddress(a.address) ?? appConfig.copy.intake.addressUnknown}</span>
                </span>
                <span className="ip-launch-go">{taking === a.divera_id ? appConfig.copy.intake.alarmOpening : appConfig.copy.intake.alarmOpen}</span>
              </button>
              <button
                type="button" className="ip-launch-x" aria-label={appConfig.copy.intake.dismiss} disabled={taking != null}
                onClick={() => onDismissAlarm(a)}
              >
                <Icon id="close" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        // archived Einsätze deliberately do NOT surface here (they live in the
        // Verlauf, one tap below) — with nothing open the intro sentence is enough.
        // A link session only ever lands here when ITS incident couldn't be fetched
        // (signal lost between the link and the incident) — say that instead of an
        // "eröffne einen Einsatz" it can't act on.
        // ⚠️ «übernimm einen Divera-Alarm» only where there IS an Alarmquelle, and named
        // after whichever one this station runs. Every station saw the Divera sentence —
        // including the ones on another source and the ones entering every Einsatz by
        // hand, who were pointed at a product they do not have.
        <p className="ip-emptyapp-none">{
          linkScoped ? appConfig.copy.incidentLink.unavailable
            : !isEditor ? appConfig.copy.emptyApp.bodyViewer
              : alarmProvider ? fillTemplate(appConfig.copy.emptyApp.bodyEditorAlarm, { provider: alarmProvider })
                : appConfig.copy.emptyApp.bodyEditor
        }</p>
      )}
      <div className="ip-emptyapp-actions">
        {/* the link's Einsatz could not be fetched: the sentence above says so, and this is
            the one thing the responder can do about it — a link session has no other
            affordance on this card */}
        {linkScoped && openIncidents.length === 0 && (
          <button className="ip-btn primary block" onClick={() => location.reload()}>
            <Icon id="rotate" />{appConfig.copy.incidentLink.retry}
          </button>
        )}
        {isEditor && (
          <button className="ip-btn primary block" onClick={() => onCreate()}>
            <Icon id="plus" />{appConfig.copy.intake.manualIncident}
          </button>
        )}
        {/* Verlauf lists OTHER incidents — not on the link allowlist, and not this
            responder's business either */}
        {!linkScoped && (
          <div className="ip-emptyapp-secondary">
            <button className="ip-btn" onClick={() => onHistory()}><Icon id="list" />{appConfig.copy.emptyApp.history}</button>
            {/* Objektbesuche: only where the station switched the module on; every account
                may read, the surface hides what a role may not capture */}
            {onObjectVisits && (
              <button className="ip-btn" onClick={() => onObjectVisits()}>
                <Icon id="clipboard" />{appConfig.copy.objectVisits.launcher}
              </button>
            )}
          </div>
        )}
      </div>
      {/* footer: who is signed in (same identity card as the in-incident menu) plus the
          app-level utilities that exist without an incident — settings, help, install */}
      <div className="ip-emptyapp-foot">
        <div className="ip-menu-user">
          <span className="ip-menu-av" style={{ background: user.color ?? 'var(--ink-faint)' }}>{initials(user.display_name)}</span>
          <span className="ip-menu-userinfo">
            <span className="ip-menu-username">{user.display_name}</span>
            <span className="ip-menu-userrole">{roleLabel(user.role)}</span>
          </span>
          {/* ⚠️ No «Abmelden» for a link session (02.09.). A link is the literal page: it
              signs nothing in on this phone and therefore has nothing to sign out — the
              bare site is whoever it was before the link was tapped, and stays so (lib/
              linkMode). The button here used to end the DEVICE's own session. */}
          {!linkScoped && (
            <button className="ip-foot-logout" onClick={() => onLogout()}><Icon id="logout" />{appConfig.copy.incidentSwitcher.logout}</button>
          )}
        </div>
        <div className="ip-emptyapp-utils">
          <button className="ip-foot-util" onClick={() => onSettings()}><Icon id="gear" />{appConfig.copy.settings.title}</button>
          <button className="ip-foot-util" onClick={() => onHelp()}><Icon id="info" />{appConfig.copy.help.menu}</button>
          {onInstall && (
            <button className="ip-foot-util" onClick={() => onInstall()}><Icon id="share-ios" />{appConfig.copy.install.menu}</button>
          )}
        </div>
      </div>
      <div className="ip-emptyapp-ver">{buildLabel()}</div>
    </>
  )
}

/** Home's «Einsätze ▾» (owner, 17.10.2026): the SAME menu as inside an Einsatz — the same rows
 *  (panels/AppMenuRows), without the card, plus the alarms waiting to be taken. A row that opens
 *  something over the viewer shuts the sheet (`close`); «Auf diesem Gerät» is the viewer's own
 *  (`onDevice`), in the slot the Einsatz menu gives «Offline-Bereitschaft». Never for a link
 *  session (appScreen gives it no viewer), so every account door is drawn here. */
export function HomeMenu({
  close, onDevice, trouble, onTrouble, onTroubleDismiss, linkScoped, isEditor, user, incidents, activeId, opening,
  alarms, taking, onTake, onDismissAlarm, onOpenIncident, onHistory, onCreate, onObjectVisits, onSettings, onUeben, onHelp,
  onInstall, onLogout,
}: HomeActions & { close: () => void; onDevice: () => void }) {
  return (
    <>
      {trouble && !linkScoped && (
        <FeedbackPrompt trouble={trouble} onOpen={() => { close(); onTrouble(trouble) }} onDismiss={onTroubleDismiss} />
      )}
      <AppMenuRows
        activeId={null}
        incidents={incidents}
        isEditor={isEditor}
        user={user}
        opening={opening}
        alarms={alarms.length > 0 ? { list: alarms, taking, onTake, onDismiss: onDismissAlarm } : undefined}
        // the open Einsatz behind the viewer steps aside rather than reopening (App · openOrUncover)
        onSwitch={(i) => { if (i.id === activeId) close(); onOpenIncident(i) }}
        onHistory={() => { close(); onHistory() }}
        onCreate={() => { close(); onCreate() }}
        onObjectVisits={onObjectVisits ? () => { close(); onObjectVisits() } : undefined}
        onSettings={() => { close(); onSettings() }}
        offline={{ label: appConfig.copy.karte.device.title, onOpen: onDevice }}
        onUeben={onUeben ? () => { close(); onUeben() } : undefined}
        onHelp={() => { close(); onHelp() }}
        onInstall={onInstall ? () => { close(); onInstall() } : undefined}
        onLogout={() => { close(); onLogout() }}
      />
    </>
  )
}
