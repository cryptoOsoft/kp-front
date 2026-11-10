import { ShellLoader } from '../components/ShellLoader'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { cx } from '../lib/cx'
import { caretToEnd } from '../lib/ui'
import { apiGet, apiPost, apiPatch, ApiError } from '../lib/api'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { Icon } from '../lib/icons'
import { ActionMenu, Card, ConfirmPrompt, EmptyState, Field, StatusBadge, fmtDate } from './ui'
import { useCellLabels } from './useCellLabels'
import { RoleChoice, type MemberRole } from './RoleChoice'
import { PinSheet } from './PinSheet'
import { isValidPin, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '../components/PinPad'

// ─── types ───────────────────────────────────────────────────────────────────

interface AdminUser {
  id: string
  username: string
  display_name: string
  role: MemberRole
  color: string | null
  is_active: boolean
  created_at: string
  last_login: string | null
  /** login starts in the Einsatzleiter view (frontend default; device-overridable) */
  el_view_default: boolean
}

// ─── helpers ───────────────────────────────────────────────────────────────

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.detail
  return appConfig.copy.admin.common2.unknownError
}

/** The German label of a member role, for the table's Rolle column.
 *  ⚠️ A `Record` on the role union, not a ternary: the binary ternary this replaces had no `el`
 *  branch, so every Einsatzleiter was shown as «Betrachter» — the picker three rows below had it
 *  right the whole time. Built here rather than at module scope so a locale overlay is read at
 *  render time; a fourth role now fails to compile instead of silently reading as a viewer. */
function roleLabel(role: MemberRole): string {
  const C = appConfig.copy.admin.members
  const labels: Record<MemberRole, string> = {
    editor: C.roleEditor,
    el: C.roleEl,
    viewer: C.roleViewer,
  }
  return labels[role]
}

// ─── add-member form ───────────────────────────────────────────────────────

// Open state lives in MembersView: the trigger sits in the members card's header and the
// teaching empty state below the table opens the same form, and a card that can only be opened
// from one place is a dead end on the screen a fresh station lands on with nothing in it.
function AddMemberForm({ open, setOpen, onCreated }: {
  open: boolean
  setOpen: (open: boolean) => void
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  // NO default: the role is a question the form asks, not a value it pre-fills. Three crew
  // accounts were once created without noticing the «Betrachter» default and all three came out
  // read-only — found only when somebody could not write during an incident.
  const [role, setRole] = useState<MemberRole | null>(null)
  const [color, setColor] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const reset = () => {
    setUsername(''); setDisplayName(''); setRole(null); setColor(''); setPin('')
    setErr(null)
  }

  const C = appConfig.copy.admin.members
  const valid =
    username.trim().length > 0 &&
    displayName.trim().length > 0 &&
    role !== null &&
    isValidPin(pin)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || busy || role === null) return
    setBusy(true)
    setErr(null)
    try {
      await apiPost('/api/auth/users', {
        username: username.trim(),
        display_name: displayName.trim(),
        role,
        color: color.trim() || null,
        pin,
      })
      reset()
      setOpen(false)
      onCreated()
    } catch (e2) {
      setErr(errText(e2))
    } finally {
      setBusy(false)
    }
  }

  // Closed, the form renders nothing at all — its trigger lives in the members card's header
  // (ui · Card `action`), not in a bar of its own floating above the page.
  if (!open) return null

  // Renders INSIDE the members card, directly under the header whose button opened it — not as a
  // card of its own at the top of the page, where the click scrolled the form out of sight.
  return (
    <form className="adm-members-addbox" onSubmit={submit}>
      <p className="adm-card-cap">{fillTemplate(C.addCaption, { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH })}</p>
      <>
        <div className="adm-row-2">
          <Field label={C.username}>
            <input
              className="adm-input adm-input-mono"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder={C.usernamePlaceholder}
            />
          </Field>
          <Field label={C.displayName}>
            <input
              className="adm-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
              placeholder={C.displayNamePlaceholder}
            />
          </Field>
        </div>
        <RoleChoice
          value={role}
          onChange={setRole}
          label={fillTemplate(C.roleQuestion, { name: displayName.trim() || C.roleQuestionAnon })}
          hint={C.roleChangeableHint}
        />
        <div className="adm-row-2">
          <Field label={C.pinLabel} hint={fillTemplate(C.pinDigits, { min: PIN_MIN_LENGTH, max: PIN_MAX_LENGTH })}>
            <input
              className="adm-input adm-input-mono"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••••"
            />
          </Field>
          <Field label={C.colorLabel} hint={C.colorOptional}>
            <div className="adm-color-row">
              <input
                type="color"
                className="adm-color-swatch"
                value={color || '#888888'}
                onChange={(e) => setColor(e.target.value)}
                aria-label={C.pickColor}
              />
              <input
                className="adm-input adm-input-mono"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#888888"
              />
            </div>
          </Field>
        </div>

        {err && <div className="adm-state adm-state-err">{err}</div>}

        <div className="adm-members-formbtns">
          {role === null && (
            <span className="adm-pick-why">
              <Icon id="info" />
              {C.rolePickFirst}
            </span>
          )}
          <button
            type="button"
            className="btn adm-int-btn"
            onClick={() => { reset(); setOpen(false) }}
            disabled={busy}
          >
            {appConfig.copy.admin.common2.cancel}
          </button>
          <button type="submit" className="btn adm-save-btn" disabled={!valid || busy}>
            {busy && <ShellLoader />}{busy ? appConfig.copy.admin.common2.saving : appConfig.copy.admin.common2.create}
          </button>
        </div>
      </>
    </form>
  )
}

// ─── per-row inline edit (rename / role / recolor) ───────────────────────────

function EditRow({ user, canDemote, onSaved, onCancel }: {
  user: AdminUser
  /** false when this is the last active editor — the server refuses the demotion anyway. */
  canDemote: boolean
  onSaved: () => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState(user.display_name)
  // Editing is the OTHER situation: the value exists, so the current role is the selected card
  // and there is no way back to «nothing chosen».
  const [role, setRole] = useState<MemberRole>(user.role)
  const [color, setColor] = useState(user.color ?? '')
  const [elViewDefault, setElViewDefault] = useState(user.el_view_default ?? false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** «Speichern» with another role waits for its second step, like the ⋮ menu's switch (UX.14):
   *  the new role signs that person out on their devices, whichever door it came through */
  const [askingRole, setAskingRole] = useState(false)
  const C = appConfig.copy.admin.members
  const Cc = appConfig.copy.admin.common2

  const save = async () => {
    if (busy || displayName.trim().length === 0) return
    setAskingRole(false)
    setBusy(true)
    setErr(null)
    try {
      await apiPatch(`/api/auth/users/${user.id}`, {
        display_name: displayName.trim(),
        role,
        color: color.trim() || null,
        el_view_default: elViewDefault,
      })
      onSaved()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <tr className="adm-members-editrow">
      <td colSpan={6}>
        <div className="adm-members-editbox">
          <Field label={C.displayName}>
            <input
              className="adm-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
              onFocus={caretToEnd}
            />
          </Field>
          <RoleChoice
            value={role}
            onChange={setRole}
            label={fillTemplate(C.roleQuestion, { name: displayName.trim() || user.display_name })}
            locked={canDemote ? undefined : { roles: ['el', 'viewer'], reason: C.guardLastCmdRole }}
          />
          <Field label={C.colorLabel}>
            <div className="adm-color-row">
              <input
                type="color"
                className="adm-color-swatch"
                value={color || '#888888'}
                onChange={(e) => setColor(e.target.value)}
                aria-label={C.pickColor}
              />
              <input
                className="adm-input adm-input-mono"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#888888"
              />
            </div>
          </Field>
          {role === 'editor' && (
            <label className="adm-field adm-check">
              <input
                type="checkbox"
                checked={elViewDefault}
                onChange={(e) => setElViewDefault(e.target.checked)}
              />
              <span>
                {C.elViewDefault}
                <span className="adm-field-hint"> — {C.elViewDefaultHint}</span>
              </span>
            </label>
          )}
          {err && <div className="adm-state adm-state-err">{err}</div>}
          <div className="adm-members-formbtns">
            {askingRole ? (
              <ConfirmPrompt
                question={fillTemplate(C.roleConfirm, { name: displayName.trim() || user.display_name, role: roleLabel(role) })}
                onConfirm={() => void save()}
                onCancel={() => setAskingRole(false)}
              />
            ) : (
              <>
                <button type="button" className="btn adm-int-btn" onClick={onCancel} disabled={busy}>
                  {Cc.cancel}
                </button>
                <button type="button" className="btn adm-save-btn" disabled={busy}
                  onClick={() => (role !== user.role && displayName.trim().length > 0 ? setAskingRole(true) : void save())}>
                  {busy && <ShellLoader />}{busy ? Cc.saving : Cc.save}
                </button>
              </>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

// ─── the view ──────────────────────────────────────────────────────────────

type Async =
  | { kind: 'loading' }
  | { kind: 'ok'; data: AdminUser[] }
  | { kind: 'error'; detail: string }

/**
 * «Mitglieder & Zugriff» — the login accounts, not the Personenstamm. The page head names it;
 * the single card below carries only its caption.
 *
 * ⚠️ The amber notice about the shipped `fu` account is GONE (10.09.2026): a username is not a
 * finding, and the only account state worth flagging here is «this login has no PIN of its own».
 * The users API cannot answer that today — `UserAdminOut` (backend/app/schemas.py) exposes no
 * `pin_set` / `must_change_pin`, and `users.pin_hash` is NOT NULL, so every account looks
 * PIN-protected from here. No flag is drawn rather than one guessed from a username.
 */
export function MembersView() {
  const tableRef = useCellLabels()
  const [state, setState] = useState<Async>({ kind: 'loading' })
  const [editing, setEditing] = useState<string | null>(null)
  const [rowErr, setRowErr] = useState<{ id: string; detail: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** «Deaktivieren» / a role change waiting for its second step (ui · ConfirmPrompt): either one
   *  signs that person out on their devices mid-Einsatz, and both fired on one tap from the ⋮
   *  menu, between «Bearbeiten» and «PIN zurücksetzen» (sweep 09.11.2026, UX.14) */
  const [asking, setAsking] = useState<{ id: string; act: 'role' | 'deactivate' } | null>(null)
  /** the member whose PIN is being set — the pinpad Sheet is open while this is non-null */
  const [pinFor, setPinFor] = useState<AdminUser | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<AdminUser[]>('/api/auth/users')
      setState({ kind: 'ok', data })
    } catch (e) {
      setState({ kind: 'error', detail: errText(e) })
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ⚠️ `editor` ONLY — an Einsatzleiter does not keep this station administrable. `el` may edit
  // the record slice (Anwesenheit/Zeitplan, Material, Checklisten, Rapport) and nothing else, and
  // the server enforces exactly that (api/events · _el_event_ok). Counting it here would let the
  // last real Bearbeiter be demoted or deactivated because «somebody is still an editor» — after
  // which nobody can touch the tactical picture again. The server counts the same way
  // (auth/router · _count_active_editors), so the two guards agree.
  const activeEditors = state.kind === 'ok'
    ? state.data.filter((u) => u.role === 'editor' && u.is_active).length
    : 0

  // Mutate helper: runs a PATCH/POST, shows a per-row error on failure, reloads on success.
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

  const toggleActive = (u: AdminUser) =>
    mutate(u.id, () => apiPatch(`/api/auth/users/${u.id}`, { is_active: !u.is_active }))

  const toggleRole = (u: AdminUser) =>
    mutate(u.id, () => apiPatch(`/api/auth/users/${u.id}`, {
      role: u.role === 'editor' ? 'viewer' : 'editor',
    }))

  const C = appConfig.copy.admin.members

  return (
    <div className="adm-editor">

      {/* Setting a PIN goes through the app's own pinpad in a Sheet — window.prompt() can be
          suppressed without a trace on an installed iOS PWA, and this is the first action the
          setup docs ask for. */}
      {pinFor && (
        <PinSheet
          user={pinFor}
          onClose={() => setPinFor(null)}
          onSaved={() => { setPinFor(null); void load() }}
        />
      )}

      {/* No `title`: this is the page's only steady-state card, so it leans on the page head
          instead of repeating it (ui · Card). «Mitglied hinzufügen» belongs to the card as a
          whole and sits in its header, right-aligned. */}
      <Card
        caption={C.caption}
        action={
          <button type="button" className="btn adm-int-btn" onClick={() => setAddOpen(true)}>
            {C.add}
          </button>
        }
      >
        {/* Directly under the header whose button opened it — see AddMemberForm. */}
        <AddMemberForm open={addOpen} setOpen={setAddOpen} onCreated={() => void load()} />
        {state.kind === 'loading' && <EmptyState loading message={C.loading} />}
        {state.kind === 'error' && <EmptyState tone="err" message={state.detail} />}
        {/* No button of its own: «Mitglied hinzufügen» is in the card header two lines above,
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
                  <th>{C.colUsername}</th>
                  <th>{C.colRole}</th>
                  <th>{C.colStatus}</th>
                  <th>{C.colLastLogin}</th>
                  <th className="adm-members-actions-col">{C.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((u) => {
                  // Admin authority is the secret-backed session (userless), so no row is
                  // "you" — the only dead-end to prevent is removing the last active editor.
                  // «Editor» here means role `editor` and nothing else: an Einsatzleiter is not
                  // a stand-in for one (see `activeEditors`), so an `el` row is never the last
                  // Bearbeiter and never carries these guards.
                  const isLastCmd = u.role === 'editor' && u.is_active && activeEditors <= 1
                  // Server is the real guard; UI just disables to avoid obvious dead-ends.
                  // ⚠️ …with one hole on the server side: `update_user` treats only
                  // role='viewer' as a demotion, so editor → `el` slips past its last-editor
                  // check. EditRow therefore locks BOTH non-editor roles (`locked.roles`).
                  const blockDeactivate = u.is_active && isLastCmd
                  const blockDemote = u.role === 'editor' && isLastCmd
                  const busy = busyId === u.id
                  if (editing === u.id) {
                    return (
                      <EditRow
                        key={u.id}
                        user={u}
                        canDemote={!blockDemote}
                        onSaved={() => { setEditing(null); void load() }}
                        onCancel={() => setEditing(null)}
                      />
                    )
                  }
                  const asked = asking?.id === u.id ? asking : null
                  return (
                    <Fragment key={u.id}>
                    <tr className={cx(!u.is_active && 'adm-members-inactive', asked && 'adm-members-asked')}>
                      <td>
                        <span className="adm-members-name">
                          {u.color && (
                            <span
                              className="adm-members-swatch"
                              style={{ background: u.color }}
                              aria-hidden
                            />
                          )}
                          {u.display_name}
                        </span>
                      </td>
                      <td className="adm-mono">{u.username}</td>
                      <td>
                        <span className={`adm-ref-kind adm-members-role ${u.role}`}>
                          {roleLabel(u.role)}
                        </span>
                      </td>
                      <td className="adm-c-side">
                        {/* the Status column names it — the pill only has to say which one */}
                        <StatusBadge tone={u.is_active ? 'on' : 'off'} label="" state={u.is_active ? C.active : C.inactive} />
                      </td>
                      <td className="adm-mono">{fmtDate(u.last_login)}</td>
                      <td className="adm-members-actions-col adm-c-act">
                        <ActionMenu
                          ariaLabel={fillTemplate(C.guardLabel, { name: u.display_name })}
                          disabled={busy || !!asked}
                          actions={[
                            { label: appConfig.copy.admin.common2.edit, onClick: () => setEditing(u.id) },
                            {
                              label: u.role === 'editor' ? C.toViewer : C.toEditor,
                              onClick: () => setAsking({ id: u.id, act: 'role' }),
                              disabled: blockDemote,
                              title: blockDemote ? C.guardLastCmdRole : undefined,
                            },
                            {
                              label: u.is_active ? C.deactivate : C.reactivate,
                              // «Reaktivieren» takes nothing away from anybody: it acts at once
                              onClick: () => (u.is_active ? setAsking({ id: u.id, act: 'deactivate' }) : void toggleActive(u)),
                              disabled: blockDeactivate,
                              title: blockDeactivate ? C.guardLastCmdDeactivate : undefined,
                              danger: u.is_active,
                            },
                            { label: C.resetPin, onClick: () => setPinFor(u) },
                          ]}
                        />
                        {rowErr?.id === u.id && (
                          <div className="adm-state adm-state-err adm-members-rowerr">
                            {rowErr.detail}
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* The question gets a line of its own under the row. It stood in the narrow
                        Aktionen cell, where the sentence took the row's width and squeezed the
                        member's name into a column of syllables (sweep 09.11.2026). */}
                    {asked && (
                      <tr className="adm-members-askrow">
                        <td colSpan={6}>
                          <ConfirmPrompt
                            danger={asked.act === 'deactivate'}
                            question={asked.act === 'deactivate'
                              ? fillTemplate(C.deactivateConfirm, { name: u.display_name })
                              : fillTemplate(C.roleConfirm, { name: u.display_name, role: u.role === 'editor' ? C.roleViewer : C.roleEditor })}
                            onConfirm={() => { setAsking(null); void (asked.act === 'deactivate' ? toggleActive(u) : toggleRole(u)) }}
                            onCancel={() => setAsking(null)}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
