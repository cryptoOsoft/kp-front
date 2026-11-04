import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { LoadingStatus, ShellLoader } from '../ShellLoader'
import { confirmDialog, toast } from '../../lib/ui'
import { ApiError } from '../../lib/api'
import { useGeoPosition } from '../../lib/useGeoPosition'
import { MapPicker } from '../MapPicker'
import { DateTimeField } from '../TimeField'
import { Combo } from '../Combo'
import { OnOff } from '../Segmented'
import { appConfig } from '../../config/appConfig'
import { dtLocalValue, dtLocalToIso, fillTemplate } from '../../lib/format'
import { fmtDistance, haversineM } from '../../lib/geo'
import { matchesAnyQuery, searchQuery } from '../../lib/search'
import { incidentCategories, isDemoMode, shortAddress } from '../../lib/deploymentConfig'
import {
  createIncident,
  geocodeReverse,
  geocodeSearch,
  getIncident,
  listObjects,
  patchIncident,
  type GeoHit,
  type IncidentCreate,
  type IncidentFull,
  type IncidentMeta,
  type ObjectWithPlans,
} from '../../lib/incidents'
import { Modal, realCoord } from './_shared'
import { SearchField } from '../SearchField'
import { pointAtField } from '../../lib/pointAtField'
import { objectPicklistSub } from '../../lib/karte/places'

// --- Einsatz eröffnen / Einsatzdaten korrigieren -------------------------------------
// `ix` (appConfig.copy.intake) is read inside each function below rather than captured at
// module-load, so the locale resolved at boot (config/copy) applies.
//
// Two jobs, one panel: a blank MANUAL create (three location methods — object library ·
// address autocomplete · map-pick), and correcting an EXISTING incident in place. There is
// no third «take the alarm» mode any more: an alarm opens its Einsatz on arrival (2026-08-02),
// so this panel is where the expert fixes what the dispatch got wrong — Stichwort, Kategorie,
// Priorität, Ort — with the crew already on the map instead of waiting behind a wizard.

// Single guided panel — see the note above. 3am tenet: nothing hidden, nothing to memorise,
// everything correctable, before or after the incident is born.
/** The subset of `next` that actually differs from `seed`.
 *
 *  `text` is compared too, but only when it is present in `next` — the fetch guard already keeps
 *  it out of the body when the existing Meldungstext could not be read, and an absent key here
 *  has to stay absent rather than becoming "changed to undefined".
 *
 *  Timestamps are compared as INSTANTS, not strings: the field round-trips through a formatter
 *  that drops seconds, so `2026-08-02T14:41:37Z` comes back as `…14:41:00` and a plain !==
 *  would call every save a change to the Alarmzeit — which is the bug this exists to prevent.
 *  Same-minute counts as untouched; a real edit moves the minute.
 */
export function changedOnly(next: Record<string, unknown>, seed: Record<string, unknown> | null): Record<string, unknown> {
  if (!seed) return next
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(next)) {
    if (!(k in seed)) { out[k] = v; continue } // e.g. `text`, which has no seed
    const before = seed[k]
    if (k === 'started_at') {
      const a = typeof v === 'string' ? Date.parse(v) : NaN
      const b = typeof before === 'string' ? Date.parse(before) : NaN
      if (Number.isFinite(a) && Number.isFinite(b) && Math.floor(a / 60_000) === Math.floor(b / 60_000)) continue
    }
    if (v !== before) out[k] = v
  }
  return out
}

export function EinsatzWizard({ edit, nearCoord, onClose, onCreated }: {
  /** existing incident to correct in place (PATCH) instead of creating; null = manual create */
  edit?: IncidentMeta | null
  /** current incident coord, used to rank the object library by proximity */
  nearCoord?: [number, number] | null
  onClose: () => void
  onCreated: (inc: IncidentFull) => void
}) {
  const ix = appConfig.copy.intake // read per-render so the resolved locale applies
  const [title, setTitle] = useState(edit?.title ?? '')
  const [address, setAddress] = useState(edit?.address ?? '')
  // Alarmmeldung (= incident.text). On edit it's fetched from the incident below
  // (IncidentMeta carries no text). `textReady` guards the PATCH so a save before the fetch
  // lands can't blank an existing Meldungstext.
  const [text, setText] = useState('')
  const [textReady, setTextReady] = useState(!edit)
  // Alarmierungszeit (= incident.started_at): correctable in edit mode, and settable on
  // MANUAL create so a fully analog incident (no Divera) can be nachgetragen days later
  // with its real alarm time — that timestamp is what a website/statistics feed reads.
  // Defaults to now, so live creation needs no interaction.
  const [alarmiertAt, setAlarmiertAt] = useState(
    dtLocalValue(edit ? edit.started_at : new Date().toISOString()),
  )
  // category defaults to the first VKF type (Brandbekämpfung) so the dropdown is never empty;
  // the list is the server's (`categoryLabels`), the option text translated per locale
  const kategorien = incidentCategories()
  const kategorieText = (k: string) => ix.kategorienLabels[k] ?? k
  const [kategorie, setKategorie] = useState<string | null>(edit?.type ?? kategorien[0] ?? null)
  // Priorität has NO control any more (18.09.2026): it is inferred from the alarm keywords and
  // nobody was correcting it here — a field on the intake form that only ever repeated a guess.
  // The value itself is untouched: an existing incident keeps whatever it carries (so the diff
  // below never reports a change), and a manual create sends none, which the backend derives.
  const priority = edit ? (edit.priority === 'HIGH' ? 'HIGH' : 'LOW') : null
  // [lng, lat] resolved location (object / address hit / map-pick / the alarm's own coord)
  const [coord, setCoord] = useState<[number, number] | null>(realCoord(edit?.lng, edit?.lat))
  // Übung — stats-excluded + deletable. A Probealarm that opened itself gets retro-tagged here.
  const [isExercise, setIsExercise] = useState(!!edit?.is_exercise)
  const [busy, setBusy] = useState(false)
  // the Alarmmeldung fetch FAILED — the textarea is disabled and says so, and `text` stays out of
  // the PATCH body, so a save cannot blank what could not be read (see the fetch below)
  const [textFailed, setTextFailed] = useState(false)

  /** What the incident looked like when this panel opened — the baseline the save diffs against
   *  (see submit). Frozen on mount on purpose: it is «what the operator started from», so a
   *  background sync landing mid-edit must not quietly widen or narrow what the save writes. */
  const seed = useRef(edit ? {
    title: edit.title ?? '',
    type: edit.type ?? null,
    priority: edit.priority === 'HIGH' ? 'HIGH' : 'LOW',
    address: edit.address ?? null,
    started_at: edit.started_at ?? null,
    is_exercise: !!edit.is_exercise,
    lng: realCoord(edit.lng, edit.lat)?.[0] ?? null,
    lat: realCoord(edit.lng, edit.lat)?.[1] ?? null,
  } as Record<string, unknown> : null).current

  // address autocomplete
  const [hits, setHits] = useState<GeoHit[]>([])
  const [addrLoading, setAddrLoading] = useState(false)
  const [addrOpen, setAddrOpen] = useState(false)
  const addrSeq = useRef(0)
  // ⚠️ The menu has to CLOSE on an outside tap, the way Combo does. Nothing but picking a hit
  // ever closed it, so in edit mode — where the field is prefilled — merely tapping in to fix a
  // typo opened a 220px list over the three location buttons and the Stichwort field below it.
  // The next tap anywhere in that band landed on an address row and silently rewrote the address
  // AND the coordinate. Esc closes the menu before the sheet, so the way out is not «discard
  // every edit».
  const addrRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!addrOpen) return
    const onDown = (e: PointerEvent) => {
      if (!addrRef.current?.contains(e.target as Node)) setAddrOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()   // the sheet's own Esc must not fire and throw the edits away
      setAddrOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [addrOpen])

  // object library picker
  const [objOpen, setObjOpen] = useState(false)
  const [objQuery, setObjQuery] = useState('')
  const [objects, setObjects] = useState<ObjectWithPlans[]>([])

  // map picker (self-contained — works with no active incident yet)
  const [mapOpen, setMapOpen] = useState(false)

  // The «Koordinaten» fold. DERIVED until the operator says otherwise (null = nobody has),
  // so picking an address or an object closes it on its own and clearing the address opens it
  // again — the fold follows the fact instead of freezing whatever was true at mount.
  const [coordOverride, setCoordOverride] = useState<boolean | null>(null)
  const coordOpen = coordOverride ?? !(coord && address.trim())

  // «Hier» — the PRIMARY location method: the EL usually stands at (or near) the Einsatzort,
  // so one tap takes a GPS fix; object library / map pick are the fallbacks for elsewhere
  const [locating, setLocating] = useState(false)
  // ⚠️ On an EXISTING Einsatz «Hier» always asks first. It is the largest button in the panel
  // and it moves the Einsatzort to wherever the device is standing — and the panel is most often
  // opened from the Magazin, hours later, to fix an address. One mis-tap moved the incident to
  // the station and took the map, the Kroki framing, the offline tile box and the nearest-object
  // plan surfacing with it, silently. Creating is untouched: there is nothing to move yet.
  const confirmMove = async (c: [number, number]): Promise<boolean> => {
    const from = realCoord(edit?.lng, edit?.lat)
    if (!edit || !from) return true
    return confirmDialog({
      title: ix.moveConfirmTitle,
      message: fillTemplate(ix.moveConfirmMsg, { d: fmtDistance(haversineM(from, c)) }),
      confirmLabel: ix.moveConfirmBtn,
    })
  }
  const useHere = () => {
    if (locating) return
    if (!navigator.geolocation) { toast(ix.hereFailed, { icon: 'warn', tone: 'warn' }); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        const c: [number, number] = [p.coords.longitude, p.coords.latitude]
        void confirmMove(c).then((ok) => { if (ok) applyPicked(c) })
      },
      () => { setLocating(false); toast(ix.hereFailed, { icon: 'warn', tone: 'warn' }) },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  // device GPS (watched only while the object picker is open) so "Objekt aus
  // Feuerwehrplänen" ranks by where the responder actually stands, not the incident coord
  // NOT on the public demo: opening the Objekt step must not throw the browser's location
  // dialog at a visitor (same line as MapView · autoCoarseFixWanted)
  const myPos = useGeoPosition(objOpen && !isDemoMode())

  // a coordinate from the map picker → set it and reverse-geocode the address (so a
  // map-click fills the nearest registered address, not just bare coords)
  const applyPicked = (c: [number, number]) => {
    setCoord(c); setMapOpen(false); setAddrOpen(false)
    // ⚠️ Fills a BLANK address only — the same rule the Rapport uses for the Kroki-seeded
    // Einsatzleiter. A nudge of the map pin used to overwrite an address somebody had just
    // typed by hand, and a typed address is a statement; a reverse-geocode is a guess.
    geocodeReverse(c[1], c[0])
      .then((hit) => { if (hit?.label) setAddress((a) => (a.trim() ? a : hit.label)) })
      .catch(() => {})
  }

  // debounced swisstopo autocomplete on the address field (skip while a hit is locked in)
  useEffect(() => {
    const q = address.trim()
    if (!addrOpen || q.length < 3) { setHits([]); setAddrLoading(false); return }
    const seq = ++addrSeq.current
    setAddrLoading(true)
    const t = setTimeout(() => {
      geocodeSearch(q).then((r) => { if (addrSeq.current === seq) { setHits(r); setAddrLoading(false) } })
        .catch(() => { if (addrSeq.current === seq) { setHits([]); setAddrLoading(false) } })
    }, 300)
    return () => clearTimeout(t)
  }, [address, addrOpen])

  // load the object library when its picker is open. Rank by the responder's own GPS first
  // (where they stand), falling back to the being-set / incident coord if denied.
  //
  // The whole library comes down once and the typing is filtered HERE, exactly as the
  // Planauswahl does it (components/PlanPicker): the list is ~150 objects, so filtering is
  // instant, and it is the only way the search covers the ADDRESS as well as the name. The
  // server's `q` matches one field at a time and forgives nothing — «grenzweg» found nothing
  // while the object sitting at Grenzweg 1 was two rows down, and a typo emptied the list.
  useEffect(() => {
    if (!objOpen) return
    const ref = myPos ?? coord ?? nearCoord
    const near = ref ? `${ref[0]},${ref[1]}` : undefined
    listObjects(undefined, near).then(setObjects).catch(() => setObjects([]))
  }, [objOpen, myPos, coord, nearCoord])

  // …the same tolerance every other picker has (lib/search): umlauts in either spelling and one
  // typo from four characters up. Name OR address — «BLT» and «Grenzweg» must both find the
  // Tramdepot, because an alarm names whichever of the two the caller knows.
  const shownObjects = useMemo(() => {
    const needle = searchQuery(objQuery)
    if (!needle) return objects
    return objects.filter((o) => matchesAnyQuery(needle, o.name, o.address))
  }, [objects, objQuery])

  // Edit mode: pull the incident's Meldungstext (Alarmmeldung) — it isn't in IncidentMeta.
  useEffect(() => {
    if (!edit) return
    let alive = true
    getIncident(edit.id)
      .then((full) => { if (alive) { setText((t) => (t.trim() ? t : full.text ?? '')); setTextReady(true) } })
      // ⚠️ NOT setTextReady(true). The guard exists so a save before the fetch lands cannot
      // blank an existing Meldungstext — and the failure path is exactly when that matters:
      // on a bad connection `text` is still '' and the PATCH would write null over the
      // dispatch message the Rapport prints as «Alarmmeldung». Left false, the field stays
      // out of the body entirely and the textarea says why.
      .catch(() => { if (alive) setTextFailed(true) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.id])

  const pickHit = (h: GeoHit) => {
    setAddress(h.label); setCoord([h.lng, h.lat]); setAddrOpen(false); setHits([])
  }
  const pickObject = (o: ObjectWithPlans) => {
    if (!title.trim()) setTitle(o.name)
    if (o.address) setAddress(o.address)
    if (o.lng != null && o.lat != null) setCoord([o.lng, o.lat])
    setObjOpen(false); setAddrOpen(false)
  }

  // «Eröffnen» must never be a dead-end: after the primary «Hier»/GPS path the title is often
  // blank, which used to leave the button disabled with no hint. Fall back to the address
  // short-form, then the category label (set once the config has loaded) — a sensible incident name.
  // ⚠️ CREATE only. On an existing Einsatz the fallback is a silent rename: select-all in the
  // Stichwort field and, before a character is typed, the panel has already resolved a title —
  // save and «Gebäudebrand Schulhaus» becomes «Schulstrasse 4». Correcting is not creating; a
  // blank field there means «I am mid-edit», so the save waits instead of inventing a name.
  const effectiveTitle = edit
    ? title.trim()
    : title.trim() ||
      (address.trim() ? shortAddress(address.trim()) ?? '' : '') ||
      (kategorie ? kategorieText(kategorie) : '')
  // Demo: a visitor may explore the whole wizard, but actually opening a new Einsatz is blocked
  // (it would write to the shared backend). Editing the demo incident stays fully open.
  const demoBlocked = isDemoMode() && !edit
  const titleRef = useRef<HTMLLabelElement>(null)
  const demoRef = useRef<HTMLParagraphElement>(null)
  const submit = async () => {
    if (busy) return
    // Blocked — the Stichwort (an edit with it emptied) or the demo: the button stays tappable
    // and points at what holds it back (lib/pointAtField); a grey «Speichern» with a «*» somewhere
    // above it said nothing. `busy` stays a native disabled: that press is in flight.
    if (!effectiveTitle) { pointAtField(titleRef.current, { focus: titleRef.current?.querySelector('input') }); return }
    if (demoBlocked) { pointAtField(demoRef.current); return }
    setBusy(true)
    // Meldungstext/Alarmmeldung is sent on create, and on edit once the existing text has
    // been fetched (textReady) so a quick save can't blank it.
    const full = {
      title: effectiveTitle,
      type: kategorie,
      ...(priority ? { priority } : {}),
      address: address.trim() || null,
      ...(textReady ? { text: text.trim() || null } : {}),
      ...(dtLocalToIso(alarmiertAt) ? { started_at: dtLocalToIso(alarmiertAt) } : {}),
      is_exercise: isExercise,
      // ⚠️ `null`, not omitted, once there WAS one. The ✕ set `coord` to null and the read-out
      // agreed — but an omitted key is not written (the PATCH is exclude_unset), so the location
      // was cleared on screen, «Einsatz aktualisiert» came back, and the old coordinate was still
      // on the record and still driving the map.
      ...(coord ? { lng: coord[0], lat: coord[1] } : edit && realCoord(edit.lng, edit.lat) ? { lng: null, lat: null } : {}),
    } satisfies IncidentCreate
    // ⚠️ On EDIT, send only what actually changed. The full body re-wrote eight fields every
    // time, including three the operator may never have looked at — and `started_at` is the
    // expensive one: it is seeded through a formatter that drops seconds, and the backend stamps
    // `started_at_source = "manual"` whenever it arrives. So fixing a typo in the address rounded
    // a 03:14:37 alarm to 03:14:00 and told the statistics consumer a human had asserted the
    // time. A null `type`/`priority` was likewise invented into a value the backend deliberately
    // derives itself. Diffing also shrinks the last-write-wins window to the touched fields.
    const patch = edit ? changedOnly(full, seed) : null
    // nothing was touched — closing is the honest outcome, and it skips a write that would
    // otherwise re-stamp the record for no reason
    if (patch && !Object.keys(patch).length) { onClose(); return }
    try {
      const inc = edit && patch ? await patchIncident(edit.id, patch) : await createIncident(full)
      toast(edit ? ix.updated : ix.created, { icon: 'check', tone: 'success' })
      onCreated(inc)
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : edit ? ix.errorUpdate : ix.errorCreate, { icon: 'warn', tone: 'warn' })
      setBusy(false)
    }
  }

  // near objects float to the top of the picker when we have a coordinate
  const near = shownObjects.filter((o) => o.distance_m != null && o.distance_m <= 1000)
                       .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))
  const nearIds = new Set(near.map((o) => o.id))
  const rest = shownObjects.filter((o) => !nearIds.has(o.id)).sort((a, b) => a.name.localeCompare(b.name))
  const ObjRow = (o: ObjectWithPlans) => (
    <button key={o.id} type="button" className="ip-objrow" onClick={() => pickObject(o)}>
      <span className="ip-objrow-main">
        <span className="ip-objrow-name">{o.name}{o.distance_m != null ? <span className="ip-objrow-dist"> · {Math.round(o.distance_m)} m</span> : null}</span>
        <span className="ip-objrow-sub">{objectPicklistSub(o, o.plans.length ? ix.objectPlans(o.plans.length) : ix.objectNoPlans)}</span>
      </span>
    </button>
  )

  return (
    <>
    {mapOpen && <MapPicker initial={coord} onCancel={() => setMapOpen(false)} onConfirm={applyPicked} />}
    <Modal title={edit ? ix.editTitle : isExercise ? ix.titleNewExercise : ix.titleNew} onClose={onClose} footer={<>
      {/* «Abbrechen» in both modes (29.09.2026): the wizard is ONE step, and closing it goes back
          to the landing without opening anything — a cancel, not a «Zurück» to a previous step */}
      <button className="ip-btn" onClick={onClose}>{ix.cancel}</button>
      <button className="ip-btn primary" disabled={busy} aria-disabled={!effectiveTitle || demoBlocked} onClick={submit}>
        {/* one verb, title and button alike: «eröffnen» – and «Übung» once the switch says so */}
        {busy ? <><ShellLoader /> {edit ? ix.saving : ix.opening}</> : edit ? ix.save : isExercise ? ix.openExercise : ix.open}
      </button>
    </>}>
      {/* --- Standort --- */}
      <div className="ip-ix-head">{ix.locationHead}</div>
      <div className="ip-field ip-ac" ref={addrRef}>
        <span>{ix.addressLabel}</span>
        {/* «Hier» (GPS) is an icon-only button riding the field's own right edge — the EL usually
            stands at (or near) the Einsatzort, so it has to be reachable the moment the address
            field is in view, not buried as the first row of a menu that only opens on focus. */}
        <div className="ip-ac-input-wrap">
          <input
            value={address}
            placeholder={ix.addressPlaceholder}
            onChange={(e) => { setAddress(e.target.value); setAddrOpen(true) }}
            onFocus={() => setAddrOpen(true)}
          />
          <button type="button" className="ip-ac-locate" disabled={locating} onClick={useHere} aria-label={ix.hereButton}>
            {locating ? <ShellLoader /> : <Icon id="locate" />}
          </button>
        </div>
        {addrOpen && address.trim().length >= 3 && (
          <div className="ip-ac-menu">
            {addrLoading && <div className="ip-ac-note"><LoadingStatus>{ix.addressSearching}</LoadingStatus></div>}
            {!addrLoading && hits.length === 0 && <div className="ip-ac-note">{ix.addressNoHits}</div>}
            {hits.map((h, i) => (
              <button key={i} type="button" className="ip-ac-row" onClick={() => pickHit(h)}>
                <Icon id="flag" /> <span>{h.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ip-ix-methods">
        {/* it FOLDS the object list open — so it says so, and the `.on` state is not the only
            thing a screen reader has to go on */}
        <button type="button" className={`ip-btn${objOpen ? ' on' : ''}`} aria-expanded={objOpen} onClick={() => setObjOpen((v) => !v)}>
          <Icon id="doc" /> {ix.objectButton}
        </button>
        <button type="button" className="ip-btn" onClick={() => setMapOpen(true)}>
          <Icon id="map" /> {ix.mapPickButton}
        </button>
      </div>

      {objOpen && (
        <div className="ip-objpick">
          <SearchField className="ip-objpick-search" value={objQuery} onChange={setObjQuery} placeholder={ix.objectSearchPlaceholder} aria-label={ix.objectSearchPlaceholder} />
          <div className="ip-objlist">
            {shownObjects.length === 0 && <div className="no-hits">{ix.objectNoHits}</div>}
            {near.length > 0 && <div className="ip-objgroup">{ix.objectNear}</div>}
            {near.map(ObjRow)}
            {rest.map(ObjRow)}
          </div>
        </div>
      )}

      {/* --- Koordinaten, behind a fold (owner, 18.09.2026) ---------------------------------
          People enter an ADDRESS. The literal coordinate is what the address resolved to, and
          it stood open between the location methods and the Stichwort field on every incident
          anybody ever corrected — a row of five decimal places nobody reads and a ✕ that quietly
          clears the Einsatzort. Folded away it is still one tap from being read, cleared and
          re-picked; nothing about how it is stored or edited changed, and the map picker is
          exactly where it was, above.
          ⚠️ It opens ITSELF whenever it is the only thing left saying where this Einsatz is: no
          address, or an address that never resolved to a coordinate. «Kein Standort – wird ohne
          Koordinate eröffnet» is a warning, and a warning behind a fold is not a warning. The
          moment the operator works the head, their choice wins over the derivation. */}
      {/* ⚠️ ONE row, open or shut (20.09.2026). Opened, the head used to stay and the coordinate
          came in as a second row under it – so the fold that was meant to save the line cost two.
          Now the head BECOMES the line: the chevron stays the way back, the title gives way to
          what it was hiding, and the ✕ sits beside it as its own button. */}
      <div className="ip-fold-row">
        <button
          type="button" className={`ip-fold-head${coordOpen ? ` ip-loc${coord ? ' set' : ''}` : ''}`} aria-expanded={coordOpen}
          aria-label={ix.coordFold} onClick={() => setCoordOverride(!coordOpen)}
        >
          <Icon id="chevron-down" className="chev" aria-hidden="true" />
          {!coordOpen ? <span className="ip-fold-title">{ix.coordFold}</span> : (
            <>
              <Icon id={coord ? 'flag' : 'warn'} />
              <span className="ip-loc-txt">{coord ? `${ix.coordSet} · ${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}` : edit ? ix.coordNoneEdit : ix.coordNone}</span>
            </>
          )}
        </button>
        {coordOpen && coord && (
          <button type="button" className="ip-loc-clear" onClick={() => setCoord(null)} aria-label={ix.coordClear}><Icon id="close" /></button>
        )}
      </div>

      {/* --- Stichwort & Kategorie --- */}
      <div className="ip-ix-head">{ix.keywordHead}</div>
      <label ref={titleRef} className="ip-field"><span>{ix.titleLabel} *</span>
        {/* no autofocus — the EL usually sets the location (address / object / map) first, so
            opening with the keyboard up over the Stichwort field would be in the way */}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ix.titlePlaceholder} />
      </label>
      <div className="ip-field"><span>{ix.categoryLabel}</span>
        {/* themed Combo instead of the OS select; options are display labels, the stored
            value stays the (German) kategorie key — mapped back on change */}
        <Combo
          value={kategorie ? kategorieText(kategorie) : ''}
          options={kategorien.map(kategorieText)}
          placeholder={ix.categoryLabel}
          clearable={false}
          onChange={(label) => {
            const key = kategorien.find((k) => kategorieText(k) === label) ?? label
            setKategorie(key)
          }}
        />
      </div>
      {/* «Übung?» is a question, so «Nein | Ja» on every device (20.10.2026) – a rotated tablet
          once said «Aus | An» here and the phone «Nein | Ja» */}
      <div className="ip-onoff-row">
        <span className="ip-onoff-l">{ix.exerciseLabel}<small>{ix.exerciseSub}</small></span>
        <OnOff question ariaLabel={ix.exerciseLabel} value={isExercise} onChange={setIsExercise} />
      </div>
      {/* --- Alarmierung — the dispatch facts, everything before we arrived: when we were alarmed
          + the alarm message. The Rapportangaben hold the rest. ONE section in both modes
          (29.09.2026): the wizard asked «Meldungstext (optional)» then «Alarmzeit» with no
          eyebrow, the edit sheet «Alarmzeit» then «Alarmmeldung» under «Alarmierung» — one field,
          two names, two places, and the Rapport says «Alarmmeldung».
          Creating, the time is prefilled with now — leave it for a live incident, set it back to
          enter an analog one afterwards (the paper report keeps the bookkeeping; this row is what
          puts the right date into the catalogue). --- */}
      <div className="ip-ix-head">{ix.alarmierungHead}</div>
      <label className="ip-field"><span>{ix.alarmTime}</span>
        <DateTimeField ariaLabel={ix.alarmTime} value={dtLocalToIso(alarmiertAt)}
          onCommit={(iso) => setAlarmiertAt(dtLocalValue(iso))} />
      </label>
      <label className="ip-field"><span>{ix.alarmMessage}</span>
        {/* editing: disabled while the existing Meldungstext could not be read — editing it
            would mean typing over something invisible, and saving would blank it */}
        <textarea className="ip-textarea" rows={edit ? 3 : 2} value={text} disabled={!textReady}
          onChange={(e) => setText(e.target.value)}
          placeholder={textFailed ? ix.alarmTextUnavailable : ix.detailsPlaceholder} />
      </label>

      {demoBlocked && <p ref={demoRef} className="ip-demo-block"><Icon id="info" /> {ix.demoBlocked}</p>}
    </Modal>
    </>
  )
}
