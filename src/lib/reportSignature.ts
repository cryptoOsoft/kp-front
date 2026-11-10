// Digital signatures on the Rapport (15.10.2026, owner decisions in docs/rapport.md · «Unterschriften»).
//
// A signature is a RECORD in the workspace (`Saved.reportSignatures`), never a field that is edited:
// it is appended, and later only ever marked void. What it signs is the «signed part» of the paper
// form — Haupt-Rapport, Personal, Material (kantonale Vorlage 11-01-003) — reduced to a SHA-256 over a
// canonical JSON of exactly what prints there (`signatureScope`). The Journal is a Beilage and is not
// part of it: a late Funk row is a Nachtrag, not a reason to sign again.
//
// Validity is COMPUTED, never stored: a signature holds while it is not voided and the scope it
// signed still hashes the same. The server never refuses a save to keep a signature valid — an
// offline tablet's Anwesenheit must still arrive — so a change that slips in after the signature
// shows as «ungültig» on every device, and the printout leaves the line empty (decision E stands:
// the printed paper is the record, these strokes are only how its signature got onto it).

/** whose line it is on the paper form */
export type SignatureRole = 'el' | 'kdt'
export const SIGNATURE_ROLES: readonly SignatureRole[] = ['el', 'kdt']

/** The drawn signature: the SHAPE of the strokes only — no timing, no pressure (those would make it
 *  biometric data, see PRIVACY.md). Points are integers in a `w`×`h` box, flattened x,y,x,y… per stroke. */
export interface SignatureStrokes {
  w: number
  h: number
  d: number[][]
}

export type SignatureVoidReason = 'aendern' | 'replaced'

export interface ReportSignature {
  id: string
  role: SignatureRole
  /** the signer as named on the line — for the Einsatzleiter the Rapport's own Einsatzleiter */
  name: string
  personId?: string
  /** «Ort» of «Ort, Datum» — the station's town at the time of signing */
  place?: string
  /** when it was signed, by the signing device's clock (the Verlauf row carries the server's) */
  at: string
  /** SHA-256 hex of `signatureScope` at the moment of signing */
  scope: string
  strokes: SignatureStrokes
  /** the login it was signed on (shared station accounts: the account is not the signer) */
  account?: string
  voidedAt?: string
  voidReason?: SignatureVoidReason
}

/** The live signature per role: the newest one that was not voided. Older ones stay in the list
 *  (history) — `replaced` when a role signs again, `aendern` when somebody chose to edit. */
export function activeSignatures(list: readonly ReportSignature[] | undefined): Partial<Record<SignatureRole, ReportSignature>> {
  const out: Partial<Record<SignatureRole, ReportSignature>> = {}
  for (const s of list ?? []) {
    if (s.voidedAt) continue
    const cur = out[s.role]
    if (!cur || s.at > cur.at || (s.at === cur.at && s.id > cur.id)) out[s.role] = s
  }
  return out
}

export type SignatureState = 'valid' | 'stale'

/** valid while the signed part still hashes the same; `currentScope` undefined = not known yet
 *  (the hash is computed asynchronously) — treated as valid so the screen does not flash «ungültig» */
export function signatureState(sig: ReportSignature, currentScope: string | undefined): SignatureState {
  return currentScope === undefined || sig.scope === currentScope ? 'valid' : 'stale'
}

/** «Ändern» and «neu unterschreiben» mark every live signature void; nothing is ever deleted */
export function voidAll(list: readonly ReportSignature[] | undefined, at: string, reason: SignatureVoidReason): ReportSignature[] {
  return (list ?? []).map((s) => (s.voidedAt ? s : { ...s, voidedAt: at, voidReason: reason }))
}

/** append a new signature; an older live one of the same role is marked `replaced` */
export function addSignature(list: readonly ReportSignature[] | undefined, sig: ReportSignature): ReportSignature[] {
  const prev = (list ?? []).map((s) => (s.role === sig.role && !s.voidedAt ? { ...s, voidedAt: sig.at, voidReason: 'replaced' as const } : s))
  return [...prev, sig]
}

/** canonical JSON: keys sorted at every level, `undefined` dropped — the same facts give the same
 *  string on every device, whatever order the workspace happened to store them in */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

/** The payload keys that are NOT the signed part: the print options, the Beilagen (Kroki, Pläne,
 *  Tafel, Atemschutz, Journal, Pendenzen, Fotos, Auswertung), the moment of printing and the
 *  deployment's partner presets. Deny-listed rather than allow-listed on purpose: a section added
 *  to the paper later is signed until somebody decides it is a Beilage. */
const NOT_SIGNED = new Set([
  'options', 'attachments', 'generatedAt', 'kroki', 'krokiCaption', 'planPages', 'boardPages', 'boardMap',
  'atemschutzIntervalMin', 'atemschutzGraceSec', 'trupps', 'journal', 'pendenzen', 'auswertung', 'partnerPresets',
  'signatures', 'messungen', 'messungenLimits',
])
/** …and inside `meta`: the Lehren print in the internal Auswertung; the Kommandant's name is the
 *  deployment's default for the line, not a fact of the Einsatz */
const META_NOT_SIGNED = new Set(['lehren', 'kommandant'])

/** The signed part of a Rapport, as canonical JSON — from the SAME payload the PDF is composed from
 *  (lib/reportPdfDirect · buildDirectReportPayload), so «what is signed» is «what prints above the
 *  line», formatted exactly as it prints. */
export function signatureScope(payload: Record<string, unknown>): string {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (NOT_SIGNED.has(k)) continue
    if (k === 'meta' && v && typeof v === 'object') {
      out.meta = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([mk]) => !META_NOT_SIGNED.has(mk)))
      continue
    }
    out[k] = v
  }
  return canonicalJson(out)
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** «3fa9 c210 7be1» — the first 12 hex digits in threes of four, for the printout and the Verlauf */
export function shortChecksum(hex: string): string {
  return (hex.slice(0, 12).match(/.{1,4}/g) ?? []).join(' ')
}

/** SVG path for the strokes: quadratic segments through the midpoints, so a thinned stroke still
 *  reads as handwriting rather than a polyline. A single point draws a dot. */
export function strokesPath(s: SignatureStrokes): string {
  const out: string[] = []
  for (const d of s.d) {
    const n = d.length / 2
    if (n < 1) continue
    const x = (i: number) => d[2 * i], y = (i: number) => d[2 * i + 1]
    if (n === 1) { out.push(`M${x(0)} ${y(0)}h0.1`); continue }
    out.push(`M${x(0)} ${y(0)}`)
    for (let i = 1; i < n - 1; i++) out.push(`Q${x(i)} ${y(i)} ${(x(i) + x(i + 1)) / 2} ${(y(i) + y(i + 1)) / 2}`)
    out.push(`L${x(n - 1)} ${y(n - 1)}`)
  }
  return out.join('')
}

/** nothing drawn, or only dots — not a signature */
export function isBlank(s: SignatureStrokes | null | undefined): boolean {
  return !s || !s.d.some((d) => d.length >= 4)
}
