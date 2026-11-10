import { LoadingStatus, ShellLoader } from '../components/ShellLoader'
import { useCallback, useEffect, useRef, useState } from 'react'
import { caretToEnd } from '../lib/ui'
import { apiGet, ApiError } from '../lib/api'
import { downloadBlob } from '../lib/download'
import { PersonnelSyncDialog } from '../components/PersonnelSyncDialog'
import {
  listRoster,
  createPerson,
  updatePerson,
  importRosterCsv,
  previewRosterCsv,
  type RosterPerson,
  type RosterImportPreview,
  type RosterImportResult,
  type RosterRankDecision,
} from './rosterApi'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { loadDeploymentConfig, providerLabel } from '../lib/deploymentConfig'
import { activeRanks, rankAbbr, rankDisplay, rankLabel } from '../lib/rank'
import { Icon } from '../lib/icons'
import { Sheet } from '../lib/overlays'
import {
  ActionMenu, Card, EmptyState, Field, Select, SettingRow, SettingsSheet, standardNote, StatusBadge,
  type SelectOption,
} from './ui'
import { useCellLabels } from './useCellLabels'
import { useConfig, getPath } from './ConfigContext'

// ─── helpers ───────────────────────────────────────────────────────────────────

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.detail
  return appConfig.copy.admin.common2.unknownError
}

/** The STATION's Dienstgrade as picker options, «kein Grad» first (`activeRanks` falls back to
 *  the shipped Swiss list, so a station that has configured none still gets a usable picker).
 *
 *  ⚠️ `current` is appended when the station's list does not cover it: `Select` shows its FIRST
 *  option for a value it cannot find, so a person carrying a rank the config never got (the
 *  normal case after a Divera sync into an unconfigured station) would look rankless here and
 *  be saved as the first entry on the list. */
function rankOptions(current: string): SelectOption[] {
  const ranks = activeRanks()
  const opts: SelectOption[] = [
    { value: '', label: appConfig.copy.admin.roster.rankNoneOption },
    ...ranks.map((r) => ({ value: r.key, label: r.abbr ? `${r.label} · ${r.abbr}` : r.label })),
  ]
  if (current && !ranks.some((r) => r.key === current)) {
    opts.push({ value: current, label: rankDisplay(current) })
  }
  return opts
}

/** Status as the two options of a picker. The value is the `is_active` flag, spelled. */
const ACTIVE = 'active'
function statusOptions(): SelectOption[] {
  const C = appConfig.copy.admin.roster
  return [{ value: ACTIVE, label: C.active }, { value: 'inactive', label: C.inactive }]
}

// ─── add-person form ─────────────────────────────────────────────────────────

// Controlled by RosterView: the open state and the trigger live in the roster card's HEADER, and
// this renders as the first thing inside that same card's body — never as a card of its own further
// up the page, which is where it used to appear. A control in one place that opens a form in
// another leaves you hunting for what just happened (and above the fold, off screen entirely).
// Inline also makes adding and editing the same gesture: `EditRow` opens the same shape in the row.
function AddPersonForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [displayName, setDisplayName] = useState('')
  const [rank, setRank] = useState('')
  const [status, setStatus] = useState(ACTIVE)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // ⚠️ The person exists on the server as soon as the POST returns, even when the Status step
  // after it fails — pressing «Erstellen» again has to finish that person, not add a second one.
  const createdId = useRef<string | null>(null)

  const C = appConfig.copy.admin.roster
  const Cc = appConfig.copy.admin.common2
  const valid = displayName.trim().length > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setErr(null)
    try {
      if (!createdId.current) {
        const person = await createPerson({ display_name: displayName.trim(), rank: rank || null })
        createdId.current = person.id
      }
      // A second write, because the create body carries no Status: the server always creates an
      // ACTIVE person (backend/app/api/personnel.py · create_person, schemas · PersonnelCreate).
      if (status !== ACTIVE) await updatePerson(createdId.current, { is_active: false })
      onCreated()
    } catch (e2) {
      setErr(errText(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="adm-members-addbox" onSubmit={submit}>
      <p className="adm-card-cap">{C.addPersonCaption}</p>
      <>
        <div className="adm-row-3">
          <Field label={C.name}>
            <input
              className="adm-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
              placeholder={C.namePlaceholder}
            />
          </Field>
          <Field label={C.colRank}>
            <Select value={rank} ariaLabel={C.colRank} onChange={setRank} options={rankOptions(rank)} />
          </Field>
          <Field label={C.colStatus}>
            <Select value={status} ariaLabel={C.colStatus} onChange={setStatus} options={statusOptions()} />
          </Field>
        </div>

        {err && <div className="adm-state adm-state-err">{err}</div>}

        <div className="adm-members-formbtns">
          <button type="button" className="btn adm-int-btn" onClick={onClose} disabled={busy}>
            {Cc.cancel}
          </button>
          <button type="submit" className="btn adm-save-btn" disabled={!valid || busy}>
            {busy && <ShellLoader />}{busy ? Cc.saving : Cc.create}
          </button>
        </div>
      </>
    </form>
  )
}

// ─── per-row inline edit ──────────────────────────────────────────────────────

function EditRow({ person, onSaved, onCancel }: {
  person: RosterPerson
  onSaved: () => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState(person.display_name)
  const [rank, setRank] = useState(person.rank ?? '')
  const [status, setStatus] = useState(person.is_active ? ACTIVE : 'inactive')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const C = appConfig.copy.admin.roster
  const Cc = appConfig.copy.admin.common2
  // A provider owns this person's record — the next synchronisation writes over what is set
  // here (see the note at the Quelle line below).
  const provider = person.external_identities?.[0]?.provider

  const save = async () => {
    if (busy || displayName.trim().length === 0) return
    setBusy(true)
    setErr(null)
    try {
      await updatePerson(person.id, {
        display_name: displayName.trim(),
        rank: rank || null,
        is_active: status === ACTIVE,
      })
      onSaved()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <tr className="adm-members-editrow">
      <td colSpan={5}>
        <div className="adm-members-editbox">
          <div className="adm-row-3">
            <Field label={C.name}>
              <input
                className="adm-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
                onFocus={caretToEnd}
              />
            </Field>
            {/* The provider hints are on the two fields the sync actually overwrites, not on the
                card: an operator setting a Dienstgrad has to read it while setting it. */}
            <Field
              label={C.colRank}
              hint={provider ? fillTemplate(C.providerRankHint, { provider: providerLabel(provider) }) : undefined}
            >
              <Select value={rank} ariaLabel={C.colRank} onChange={setRank} options={rankOptions(rank)} />
            </Field>
            <Field
              label={C.colStatus}
              hint={provider ? fillTemplate(C.providerStatusHint, { provider: providerLabel(provider) }) : undefined}
            >
              <Select value={status} ariaLabel={C.colStatus} onChange={setStatus} options={statusOptions()} />
            </Field>
          </div>
          {/* ⚠️ The row the Quelle column names is a PROVIDER-OWNED record: the next sync
              rewrites the Dienstgrad from the member's qualifications whenever the feed carries
              any (backend/app/personnel.py · execute_sync), and reactivates anybody still listed
              there. The two fields above say so where it is decided; this line says whose. */}
          {provider && (
            <span className="adm-int-stat adm-int-muted">{`${C.colSource}: ${providerLabel(provider)}`}</span>
          )}
          {err && <div className="adm-state adm-state-err">{err}</div>}
          <div className="adm-members-formbtns">
            <button type="button" className="btn adm-int-btn" onClick={onCancel} disabled={busy}>
              {Cc.cancel}
            </button>
            <button type="button" className="btn adm-save-btn" onClick={() => void save()} disabled={busy}>
              {busy && <ShellLoader />}{busy ? Cc.saving : Cc.save}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ─── CSV import: the mapping step ──────────────────────────────────────────────

/** One decision per unknown VALUE, keyed by that value. */
type Decisions = Record<string, RosterRankDecision>

/** What the picker for one unknown value offers, encoded as a single string:
 *  `adopt` · `skip` · `rank:<key>`. */
const ADOPT = 'adopt'
const SKIP = 'skip'

function decisionToOption(d: RosterRankDecision): string {
  return d.action === 'map' ? `rank:${d.rank}` : d.action
}

function optionToDecision(value: string, option: string): RosterRankDecision {
  if (option === ADOPT) return { value, action: 'adopt' }
  if (option === SKIP) return { value, action: 'skip' }
  return { value, action: 'map', rank: option.slice('rank:'.length) }
}

/** The first thing offered for a value: the rank whose spelling the server found closest, or
 *  else adopting it as a new one. Never a silent drop — «weglassen» has to be chosen. */
function initialDecisions(preview: RosterImportPreview): Decisions {
  const out: Decisions = {}
  for (const g of preview.unknown_ranks) {
    out[g.value] = g.suggestion
      ? { value: g.value, action: 'map', rank: g.suggestion }
      : { value: g.value, action: 'adopt' }
  }
  return out
}

/**
 * The confirmation step — shown for EVERY file, before a single row is written.
 *
 * It answers two questions, and the first one is why it is unconditional: how many of these
 * people the station already has (they get updated) and how many are new. A station imported a
 * 14-person roster, re-picked the same file, and got 28 rows behind a green «14 importiert» —
 * because the only confirmation this import had was the rank mapping below, and after the first
 * import every rank was known, so the second one went straight through.
 *
 * The second question is the mapping, which appears only when the file uses a Dienstgrad the
 * station's list does not know: ONE row per unknown VALUE, with three answers:
 * put it on a rank the station has, adopt it as a new
 * rank of the station, or import those people without a Dienstgrad.
 *
 * ⚠️ «Übernehmen» writes the station's `roster.ranks`. On a station that has never configured
 * one, this sheet is the only place in the browser where a rank list can come into existence at
 * all (it is otherwise a CLI push), which is why the option is here and not behind a warning.
 */
function ImportConfirmSheet({ file, preview, onCancel, onDone }: {
  file: File
  preview: RosterImportPreview
  onCancel: () => void
  onDone: (result: RosterImportResult) => void
}) {
  const C = appConfig.copy.admin.roster
  const Cc = appConfig.copy.admin.common2
  const [decisions, setDecisions] = useState<Decisions>(() => initialDecisions(preview))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const groups = preview.unknown_ranks
  const mapping = groups.length > 0
  const nothing = preview.creates + preview.updates === 0
  const adoptAll = () =>
    setDecisions(Object.fromEntries(groups.map((g) => [g.value, { value: g.value, action: 'adopt' as const }])))
  const allAdopted = mapping && groups.every((g) => decisions[g.value]?.action === 'adopt')
  const anyAdopted = groups.some((g) => decisions[g.value]?.action === 'adopt')

  const options = [
    { value: ADOPT, label: '' }, // filled per row below
    ...preview.known_ranks.map((r) => ({
      value: `rank:${r.key}`,
      label: r.abbr ? `${r.label} · ${r.abbr}` : r.label,
    })),
    { value: SKIP, label: C.mapDropOption },
  ]

  const apply = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      onDone(await importRosterCsv(file, groups.map((g) => decisions[g.value])))
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onCancel}
      fit
      title={mapping ? C.mapTitle : C.confirmTitle}
      footer={
        <>
          <button type="button" className="ip-btn" onClick={onCancel} disabled={busy}>{Cc.cancel}</button>
          <button type="button" className="ip-btn primary" onClick={() => void apply()} disabled={busy || nothing}>
            {busy
              ? <LoadingStatus>{C.importing}</LoadingStatus>
              : mapping
                ? fillTemplate(allAdopted ? C.mapAdoptAndImport : C.mapApplyAndImport, { n: preview.total })
                : C.confirmImport}
          </button>
        </>
      }
    >
      <p className="ip-head-sub">{fillTemplate(C.confirmSubtitle, { file: file.name, n: preview.total })}</p>

      {/* Both numbers, always — «Neu: 0 · Wird aktualisiert: 14» is the one sentence that tells
          an operator the file has already been imported. */}
      <ul className="adm-roster-plan">
        <li>{fillTemplate(C.confirmNew, { n: preview.creates })}</li>
        <li>{fillTemplate(C.confirmUpdated, { n: preview.updates })}</li>
        {preview.skipped > 0 && <li>{fillTemplate(C.confirmSkippedRows, { n: preview.skipped })}</li>}
      </ul>
      <p className="ip-hint">{nothing ? C.confirmNothing : C.confirmMatchHint}</p>

      {mapping && <p className="ip-hint">{C.mapIntro}</p>}

      {/* The station is still on the shipped list — then the file is usually the better source,
          and working through six rows one by one is busywork. */}
      {!preview.has_own_ranks && groups.length > 1 && (
        <div className="adm-rankmap-note">
          <Icon id="info" />
          <div className="adm-rankmap-note-txt">
            <span className="adm-rankmap-note-t">{C.mapNoOwnListTitle}</span>
            <span className="adm-rankmap-note-b">{C.mapNoOwnListBody}</span>
            <div className="adm-rankmap-note-acts">
              <button type="button" className="btn adm-save-btn" onClick={adoptAll} disabled={busy || allAdopted}>
                {fillTemplate(C.mapAdoptAll, { n: groups.length })}
              </button>
            </div>
          </div>
        </div>
      )}

      {mapping && (
        <div className="adm-table-wrap adm-rankmap-wrap">
          <table className="adm-table adm-rankmap">
            <thead>
              <tr>
                <th>{C.mapColValue}</th>
                <th>{C.mapColAffected}</th>
                <th className="adm-rankmap-target">{C.mapColTarget}</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.value}>
                  <td>
                    <span className="adm-rankmap-raw">{g.value}</span>
                    <div className="adm-rankmap-count">
                      {g.count === 1 ? C.mapPeopleCountOne : fillTemplate(C.mapPeopleCount, { n: g.count })}
                    </div>
                  </td>
                  <td className="adm-rankmap-count">
                    {g.people.join(', ')}
                    {g.count > g.people.length && ` …`}
                  </td>
                  <td>
                    <Select
                      ariaLabel={fillTemplate(C.mapTargetFor, { value: g.value })}
                      value={decisionToOption(decisions[g.value])}
                      onChange={(o) => setDecisions((d) => ({ ...d, [g.value]: optionToDecision(g.value, o) }))}
                      options={options.map((o) =>
                        o.value === ADOPT ? { ...o, label: fillTemplate(C.mapAdoptOption, { value: g.value }) } : o,
                      )}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Only where it is true: an adopted rank IS known next time, because it is in the
          station's list from then on. A mapping is a one-off decision about one file. */}
      {anyAdopted && (
        <div className="adm-rankmap-note">
          <Icon id="info" />
          <div className="adm-rankmap-note-txt">
            <span className="adm-rankmap-note-t">{C.mapAdoptNoteTitle}</span>
            <span className="adm-rankmap-note-b">{C.mapAdoptNoteBody}</span>
          </div>
        </div>
      )}
      {!preview.has_own_ranks && anyAdopted && <p className="ip-hint">{C.mapMaterialiseHint}</p>}
      {preview.errors.length > 0 && (
        <ul className="adm-roster-errors">
          {preview.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {err && <div className="adm-state adm-state-err">{err}</div>}
    </Sheet>
  )
}

// ─── CSV import card ───────────────────────────────────────────────────────────

function CsvImportCard({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RosterImportResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<{ file: File; preview: RosterImportPreview } | null>(null)
  const { applyServerRanks } = useConfig()
  const C = appConfig.copy.admin.roster

  // Provider-neutral portable baseline. Provider identities are established by sync.
  const downloadTemplate = () => {
    const csv = 'name,rank\r\nMuster Max,\r\nBeispiel Anna,fw\r\n'
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, 'mannschaft-vorlage.csv')
  }

  /** Everything the import wrote is now on the server — including, after an adoption, a rank
   *  list this tab's config draft has never seen (see ConfigContext · applyServerRanks).
   *
   *  ⚠️ The order is the fix for «der Grad bleibt leer bis zum Neuladen». An adopted rank key
   *  only resolves to a label once `loadDeploymentConfig()` has replaced the module singleton
   *  every read site uses (src/lib/rank · activeRanks); `applyServerRanks` alone updates the
   *  Verwaltung's own draft, not that singleton. Reloading the list first would render the
   *  brand-new keys through a list that does not contain them — blank, right after the sheet
   *  promised «dann sind sie bekannt». */
  const finish = async (res: RosterImportResult) => {
    setResult(res)
    setPending(null)
    // loadDeploymentConfig() never throws: a failed refresh is a stale tab, not lost data.
    if (res.adopted_ranks.length > 0) applyServerRanks(await loadDeploymentConfig())
    onImported()
  }

  // Pick a file → find out what it WOULD do, and say so. NOTHING is written before the operator
  // confirms — not even a file whose ranks are all known, which is exactly the file a second
  // import of an already-imported roster produces.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setErr(null)
    setResult(null)
    try {
      setPending({ file, preview: await previewRosterCsv(file) })
    } catch (e2) {
      setErr(errText(e2))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ⚠️ `sourceHint` is the caption and NOTHING else: it used to be the card title's ⓘ and the
  // caption underneath it, word for word, so the tip only ever repeated the line above it.
  return (
    <Card title={C.csvImport} caption={C.sourceHint}>
      <div className="adm-roster-import">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="adm-file-hidden"
          onChange={(e) => void onFile(e)}
          disabled={busy}
        />
        {/* Download first, upload second: the file you start FROM, then the one you send back.
            The import is this card's committing action, so it is the single primary. */}
        <button type="button" className="btn adm-int-btn" onClick={downloadTemplate}>
          {C.csvTemplate}
        </button>
        <button type="button" className="btn adm-save-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
          {C.csvImport}
        </button>
        {busy && <span className="adm-int-stat"><LoadingStatus>{C.importing}</LoadingStatus></span>}
      </div>
      {err && <div className="adm-state adm-state-err">{err}</div>}
      {result && (
        <div className="adm-roster-result">
          {/* Five pills, not one ResultChip: new and updated stay apart afterwards too — «14
              importiert» is exactly what a station read while its Wehr was being written a
              second time — and each count carries its own tone, which one chip cannot. */}
          {result.created > 0 && (
            <StatusBadge tone="on" label="" state={fillTemplate(C.createdBadge, { n: result.created })} />
          )}
          {result.updated > 0 && (
            <StatusBadge tone="on" label="" state={fillTemplate(C.updatedBadge, { n: result.updated })} />
          )}
          {result.imported === 0 && (
            <StatusBadge tone="off" label="" state={fillTemplate(C.imported, { n: 0 })} />
          )}
          {result.skipped > 0 && (
            <StatusBadge tone="warn" label="" state={fillTemplate(C.skipped, { n: result.skipped })} />
          )}
          {result.adopted_ranks.length > 0 && (
            <StatusBadge
              tone="on"
              label=""
              state={result.adopted_ranks.length === 1
                ? C.ranksAdoptedOne
                : fillTemplate(C.ranksAdopted, { n: result.adopted_ranks.length })}
            />
          )}
          {result.errors.length > 0 && (
            <ul className="adm-roster-errors">
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* ⚠️ Cancelling here leaves the station exactly as it was: the preview wrote nothing, and
          the import that would have is never sent. The Sheet portals, so it sits in the card's
          body without being laid out by it. */}
      {pending && (
        <ImportConfirmSheet
          file={pending.file}
          preview={pending.preview}
          onCancel={() => setPending(null)}
          onDone={(res) => void finish(res)}
        />
      )}
    </Card>
  )
}

// ─── the view ──────────────────────────────────────────────────────────────────

type Async =
  | { kind: 'loading' }
  | { kind: 'ok'; data: RosterPerson[] }
  | { kind: 'error'; detail: string }

/** Station-wide name order. Sits on THIS page rather than under Doktrin because the list it
 *  changes is right underneath — you pick an order and read the result, instead of switching
 *  pages to find out what you did. One order for the whole Wehr: two operators reading the same
 *  Trupp card differently is worse than either order being the "wrong" one. */
function NameOrderCard() {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.roster
  // 'last-first' is the shipped default AND what the Divera sync writes — an unset config and a
  // config set to last-first have to look the same in the picker.
  const value = getPath<string>(draft, ['roster', 'nameOrder']) === 'first-last' ? 'first-last' : 'last-first'
  // The Standard column speaks in the picker's own words, not in the stored key — «last-first»
  // is not a word anybody chose. It stays silent while the shipped order is in force.
  // ⚠️ The SHORT labels, not the picker's: the option carries an example («Nachname Vorname ·
  // Meier Hans») and `standardNote` appends «geändert», so the full label would put three
  // ·-separated parts in the narrowest column on the page.
  const chosen = value === 'first-last' ? C.nameOrderShortFirstLast : C.nameOrderShortLastFirst
  return (
    <SettingsSheet title={C.nameOrderTitle} caption={C.nameOrderCaption}>
      <SettingRow
        label={C.nameOrderLabel}
        tip={C.nameOrderTip}
        standard={standardNote(chosen, C.nameOrderShortLastFirst)}
      >
        <Select
          value={value}
          ariaLabel={C.nameOrderLabel}
          onChange={(v) => set(['roster', 'nameOrder'], v)}
          options={[
            { value: 'last-first', label: C.nameOrderLastFirst },
            { value: 'first-last', label: C.nameOrderFirstLast },
          ]}
        />
      </SettingRow>
    </SettingsSheet>
  )
}

/**
 * How much the NIGHTLY Divera sync may do on its own. Same page and same pattern as the name
 * order: one config field, the list it changes right underneath.
 *
 * ⚠️ Only shown where it can do anything — a station with no Divera personnel key runs the job
 * idle whatever this says, and a setting that changes nothing is worse than an absent one. The
 * three options are written so the difference is legible without opening the ⓘ: «Vollständig» is
 * the only one that deactivates anybody, and that word is in the option, not only in the tip.
 */
function AutoSyncCard({ provider }: { provider: string | null | undefined }) {
  const { draft, set } = useConfig()
  const C = appConfig.copy.admin.roster
  // «safe» is both the shipped default and what an unset field means (backend · personnel ·
  // DEFAULT_AUTO_SYNC), so the two have to look identical in the picker.
  const stored = getPath<string>(draft, ['roster', 'autoSync'])
  const value = stored === 'off' || stored === 'full' ? stored : 'safe'
  if (provider !== 'divera') return null
  const chosen = value === 'off' ? C.autoSyncShortOff : value === 'full' ? C.autoSyncShortFull : C.autoSyncShortSafe
  return (
    <SettingsSheet title={C.autoSyncTitle} caption={C.autoSyncCaption}>
      <SettingRow
        label={C.autoSyncLabel}
        tip={C.autoSyncTip}
        standard={standardNote(chosen, C.autoSyncShortSafe)}
      >
        <Select
          value={value}
          ariaLabel={C.autoSyncLabel}
          onChange={(v) => set(['roster', 'autoSync'], v)}
          options={[
            { value: 'off', label: C.autoSyncOff },
            { value: 'safe', label: C.autoSyncSafe },
            { value: 'full', label: C.autoSyncFull },
          ]}
        />
      </SettingRow>
    </SettingsSheet>
  )
}

export function RosterView() {
  const tableRef = useCellLabels()
  const [state, setState] = useState<Async>({ kind: 'loading' })
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [rowErr, setRowErr] = useState<{ id: string; detail: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // undefined while capability discovery is loading; null means no provider is configured.
  const [personnelProvider, setPersonnelProvider] = useState<string | null | undefined>(undefined)
  const [syncOpen, setSyncOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await listRoster(showInactive)
      setState({ kind: 'ok', data })
    } catch (e) {
      setState({ kind: 'error', detail: errText(e) })
    }
  }, [showInactive])

  useEffect(() => { void load() }, [load])

  // Provider capability gates synchronization and CSV import. Manual entry remains available
  // for temporary/external personnel who are not managed by the configured source.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const cfg = await apiGet<{ integrations?: { personnel?: { provider?: string | null; configured?: boolean } } }>('/api/config')
        const provider = cfg.integrations?.personnel
        if (alive) setPersonnelProvider(provider?.configured ? provider.provider ?? null : null)
      } catch {
        if (alive) setPersonnelProvider(null)
      }
    })()
    return () => { alive = false }
  }, [])

  const mutate = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id)
    setRowErr(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setRowErr({ id, detail: errText(e) })
    } finally {
      setBusyId(null)
    }
  }

  // ONE write path for Status: this row action and the Status picker in EditRow both PATCH
  // `is_active`. DELETE /api/personnel/{id} does the same thing on the server, but a second
  // route for one fact is how two «Deaktivieren» come to behave differently.
  const toggleActive = (p: RosterPerson) =>
    mutate(p.id, () => updatePerson(p.id, { is_active: !p.is_active }))

  const C = appConfig.copy.admin.roster

  return (
    <div className="adm-editor">
      {/* What the SOURCE of this roster is — the one thing here that is not a card: either the
          provider's sync, or the sentence saying there is no provider (and the CSV card below is
          then the way in). Nothing renders while capability discovery is still out. */}
      {personnelProvider !== undefined && (
        <div className="adm-toolbar">
          {personnelProvider === null
            ? <span className="adm-int-stat adm-int-muted">{C.providerNotConfigured}</span>
            : (
              <button type="button" className="btn adm-int-btn" onClick={() => setSyncOpen(true)}>
                {fillTemplate(C.syncProvider, { provider: providerLabel(personnelProvider) })}
              </button>
            )}
        </div>
      )}

      <NameOrderCard />
      <AutoSyncCard provider={personnelProvider} />
      {personnelProvider === null && <CsvImportCard onImported={() => void load()} />}

      {/* Both belong to the card as a whole rather than to any row: «Inaktive anzeigen» filters
          the list, «Person hinzufügen» adds to it — that is what `action` is (ui · Card). The
          add control used to float in the toolbar above the page, where it read as belonging to
          the Namensformat card underneath it. */}
      <Card
        title={C.title}
        caption={C.caption}
        action={
          <>
            <label className="adm-roster-inactive-toggle">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              <span>{C.showInactive}</span>
            </label>
            <button type="button" className="btn adm-int-btn" onClick={() => setAddOpen(true)}>
              {C.addPerson}
            </button>
          </>
        }
      >
        <>
          {/* Directly under the header whose button opened it — see AddPersonForm. */}
          {addOpen && (
            <AddPersonForm
              onCreated={() => { setAddOpen(false); void load() }}
              onClose={() => setAddOpen(false)}
            />
          )}
          {state.kind === 'loading' && <EmptyState loading message={C.loading} />}
          {state.kind === 'error' && <EmptyState tone="err" message={state.detail} />}
          {/* «Einrichtung» sends a fresh station straight here for «Personal erfassen», and the
              answer for a whole Wehr is the Arbeitsmappe — which is named nowhere on this page.
              No button of its own: «Person hinzufügen» is in the card header two lines above,
              and the same action twice in one card is what makes the page look improvised. */}
          {state.kind === 'ok' && state.data.length === 0 && (
            <EmptyState message={C.none} hint={C.noneHint} />
          )}
          {state.kind === 'ok' && state.data.length > 0 && (
            <div className="adm-table-wrap">
              <table ref={tableRef} className="adm-table adm-members-table">
                <thead>
                  <tr>
                    <th>{C.colName}</th>
                    <th>{C.colRank}</th>
                    <th>{C.colSource}</th>
                    <th>{C.colStatus}</th>
                    <th className="adm-members-actions-col">{C.colActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.map((p) => {
                    const busy = busyId === p.id
                    if (editing === p.id) {
                      return (
                        <EditRow
                          key={p.id}
                          person={p}
                          onSaved={() => { setEditing(null); void load() }}
                          onCancel={() => setEditing(null)}
                        />
                      )
                    }
                    return (
                      <tr key={p.id} className={p.is_active ? '' : 'adm-members-inactive'}>
                        <td><span className="adm-members-name">{p.display_name}</span></td>
                        <td>
                          {/* ⚠️ rankDisplay, never rankLabel alone: a key the station's list
                              does not (yet) cover renders as the raw key, not as an empty cell.
                              A Dienstgrad that IS in the database must never look absent. */}
                          <span className="adm-members-rank" title={rankLabel(p.rank ?? undefined)}>
                            {p.rank ? (rankAbbr(p.rank) || rankDisplay(p.rank)) : C.rankNone}
                          </span>
                        </td>
                        <td>
                          <span className="adm-ref-kind">{p.external_identities?.[0] ? providerLabel(p.external_identities[0].provider) : C.sourceManual}</span>
                        </td>
                        <td className="adm-c-side">
                          {/* the Status column names it — the pill only has to say which one */}
                          <StatusBadge tone={p.is_active ? 'on' : 'off'} label="" state={p.is_active ? C.active : C.inactive} />
                        </td>
                        <td className="adm-members-actions-col adm-c-act">
                          <ActionMenu
                            ariaLabel={`${C.colActions} — ${p.display_name}`}
                            disabled={busy}
                            actions={[
                              { label: appConfig.copy.admin.common2.edit, onClick: () => setEditing(p.id) },
                              {
                                label: p.is_active ? C.deactivate : C.reactivate,
                                onClick: () => void toggleActive(p),
                                danger: p.is_active,
                              },
                            ]}
                          />
                          {rowErr?.id === p.id && (
                            <div className="adm-state adm-state-err adm-members-rowerr">{rowErr.detail}</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      </Card>

      {syncOpen && (
        <PersonnelSyncDialog
          provider={providerLabel(personnelProvider ?? '')}
          onClose={() => setSyncOpen(false)}
          onSynced={() => void load()}
        />
      )}
    </div>
  )
}
