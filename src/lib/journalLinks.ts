import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'
import type { AttendanceState, Person, TimelineEvent, Trupp } from '../types'
import { isPresent } from './attendanceIntervals'
import { getDeploymentConfig } from './deploymentConfig'
import { rankOrder } from './rank'

/**
 * Everything a journal entry can NAME — and therefore everything it can link to.
 *
 * The «Von» field is gone (09.08.). It asked a question the sentence already answers: whoever
 * writes «Meier meldet Kellerbrand bestätigt» has said who reported it, and a second field
 * asking the same thing is a second thing to fill in. What was actually wanted is that the
 * NAMES in the sentence are real — spelled the way the rest of the app spells them, and visible
 * as links rather than as prose.
 *
 * So the vocabulary is everything the Einsatz has words for: the Mannschaft, the Trupps they are
 * working in, the station's Mittel, the Partnerorganisationen, the Fahrzeuge and the
 * Alarmgruppen. Typing three letters of any of them offers the full form; whatever is in the text
 * afterwards is marked, in the composer, in the Verlauf and on the printed Rapport.
 */
export type LinkKind = 'person' | 'material' | 'partner' | 'vehicle' | 'group' | 'trupp' | 'term'

/**
 * What a marked stretch of text can be: one of the Einsatz's own words — or an address.
 *
 * A URL is the one mark that is not vocabulary. Nobody configures it and nothing completes it;
 * it is simply what somebody typed or pasted — the Meldung's ticket, a Merkblatt, the
 * Wetterradar they were reading off — and it should be openable everywhere the entry is read
 * rather than a string to copy out by hand.
 *
 * A phone number is the same kind of thing, and it is where a Meldung's callback number actually
 * lands: «Melder 079 123 45 67, wartet vor dem Haus». On the printed Rapport that number is read
 * off paper — or off a PDF on the phone that is about to dial it, which is what makes it worth
 * anchoring. See `MarkOptions.phone`: it is marked for PRINT only.
 */
export type MarkKind = LinkKind | 'url' | 'phone'

/**
 * What a pass over an entry's text marks beyond the vocabulary and the addresses.
 *
 * ⚠️ `phone` is OFF by default, and that is deliberate — the on-screen Verlauf stays TEXT-ONLY on
 * phone numbers. The screen renders a non-`url` mark as a medium-weight ink term (`Journal.tsx` ·
 * `.jr-link-*`), which is the app saying «this is one of the Einsatz's own words»; a phone number
 * is not, and dressing it up as one would be a lie about the vocabulary. A `tel:` anchor there
 * would also be a link that does nothing on the desktops the Verlauf is read on, and the composer
 * reads the last mark of a sentence to decide whether to offer the «→» («EL → Sanität»), which a
 * number must not trigger. On paper none of that applies: the anchor is the only way the number
 * gets dialled, so `linkMarkup` — the print path, and its only caller is `lib/report.ts` — turns
 * it on.
 */
export interface MarkOptions {
  /** mark Swiss phone numbers as `tel:` links. Print only — see above. */
  phone?: boolean
  /** the row's own subject (TimelineEvent.subjectId): a `trupp` term naming THAT Trupp wins over
   *  an equally long one naming another — the row is linked by id, not by the number it says */
  subjectId?: string
}

export interface JournalLink {
  /** the canonical spelling — what typing completes to and what gets marked */
  name: string
  kind: LinkKind
  /** roster id, for a person; absent for everything else */
  id?: string
  /** somebody ticked present — the only thing that breaks a tie between equal matches */
  present?: boolean
  /** the job this person holds on THIS Einsatz — «EL», «Stv. EL», «Fahrer TLF» — read off their
   *  Anwesenheits-Bemerkung. Printed after the name on its first mention in an entry, so a row
   *  reads «Rückmeldung an ELZ durch Widmer Céline (EL)» rather than naming somebody the reader
   *  has to look up. Absent for anybody without a job, which is most people. */
  role?: string
  /** What this person is doing right now — «Trupp 2», «Sicherungstrupp». Shown on the SUGGESTION
   *  CHIP only, never inserted and never printed: it answers «which Meier do I mean» at the moment
   *  of typing and stops being true ten minutes later, so it has no business in a record that is
   *  read six months on. (The `role` above is the opposite: it is stable for this Einsatz and does
   *  print.) */
  hint?: string
  /** marks the COMMAND POSTS («EL», «Stv. EL») — the one kind of term that is a job rather than a
   *  thing, which the composer reads to decide whether to offer the «→» (JournalComposer).
   *
   *  ⚠️ It no longer says anything about MATCHING (04.09.). Whole-word matching used to be opt-in
   *  here, with everything else matched as a plain substring — and the 03.09. Rapport printed
   *  «Kantons**polizei**» with the Partnerorganisation bolded inside the word. Every kind is
   *  word-bounded now; see `linkRanges`. */
  word?: boolean
  /**
   * Spelling help, not one of the Einsatz's own words: it COMPLETES while typing and is never
   * MARKED — not in the composer's backdrop, not in the Verlauf, not on the printed Rapport.
   *
   * ⚠️ The distinction is the whole reason the abbreviations and the Geschosse could be added at
   * all (10.09.). Marking is the app saying «this is a thing this Einsatz has a record of» — a
   * person, a Trupp, a Fahrzeug, a Mittel. «AS», «RWA» and «1. OG» are none of those; they are
   * how the sentence is spelled. Marked like the rest, a single ordinary line («Trupp Hager
   * Hannes prüft CO2 in UG Aggregatorraum») came out with four coloured terms in it, on screen
   * and on paper, and the marks stopped meaning anything.
   */
  plain?: boolean
  /** The Trupp this term names, for a `trupp` term — what a row ABOUT a Trupp (`subjectId`) is
   *  matched against, so its «Trupp 1» means that Trupp and not whichever holds 1 now. */
  truppId?: string
  /**
   * A number this Trupp carried BEFORE a merge renumbered it (types · Trupp.formerNos,
   * docs/trupp-naming.md §7). It marks ONLY in a row about that Trupp (`MarkOptions.subjectId`)
   * — there it beats the term of whoever holds the number now — and it never completes: typing
   * «Trupp 1» today means the Trupp that is called 1 today. `hint` then says what it is called now.
   */
  former?: boolean
}

/**
 * The whole linkable vocabulary, best-first within each kind.
 *
 * ⚠️ People are NOT filtered by attendance. Whoever an entry is about is very often somebody who
 * is not ticked present — the AdF still driving in, the Kommandant on the phone — and a list
 * that cannot spell their name is worse than none. Presence only orders.
 */
export function journalVocabulary(
  personnel: Person[],
  attendance: AttendanceState,
  /** personId → the bare NAME of the Trupp they are in right now (its Gruppenführer's name —
   *  types · Trupp.name), for the chip's hint (see JournalLink.hint). Worded through
   *  `truppTerm` below before it reaches the hint; passed bare because the caller building this
   *  map has no reason to know that wording. */
  truppOf?: Map<string, string>,
  /** every Trupp of this Einsatz — the UNFILTERED slice, removed and `raus` ones included (see
   *  `teams` below) */
  trupps?: Trupp[],
): JournalLink[] {
  const cfg = getDeploymentConfig()
  const people: JournalLink[] = personnel
    .filter((p) => p.active)
    .map((p) => {
      // ⚠️ 05.09. fix: `truppOf` carries the Trupp's bare NAME, which (types · Trupp.name) IS
      // its Gruppenführer's own name — so on the GF's own chip the hint used to repeat the name
      // it already sits beside verbatim: «Stich Markus · Stich Markus». Worded through the same
      // `truppTerm` the vocabulary's own Trupp entries use («Trupp Stich Markus», line below)
      // fixes the wording for everybody else in the crew too — but on the GF it still says
      // nothing the name chip has not already said, so it is suppressed there rather than
      // shown as «Stich Markus · Trupp Stich Markus», which is not new information either.
      const teamOf = truppOf?.get(p.id)
      const hint = teamOf && teamOf !== p.displayName
        ? fillTemplate(appConfig.copy.atemschutz.truppTerm, { name: teamOf })
        : undefined
      return {
        name: p.displayName, kind: 'person' as const, id: p.id, present: isPresent(attendance[p.id]),
        role: shortRole((attendance[p.id]?.note ?? '').trim()),
        hint,
      }
    })
    .sort((a, b) => Number(b.present) - Number(a.present)
      || rankOrder(personnel.find((p) => p.id === a.id)?.rank) - rankOrder(personnel.find((p) => p.id === b.id)?.rank)
      || a.name.localeCompare(b.name, 'de'))
  /**
   * The Trupps of this Einsatz, as «Trupp 1» (copy · atemschutz.truppTerm over the number) — and,
   * for the rows written before a Trupp had a number, as «Trupp Meier Anna».
   *
   * ⚠️ The NUMBER is the term since 12.09. (docs/trupp-naming.md §4). The app's own rows read
   * «Trupp 1 (Meier Anna / Dürring Jan): Eintritt», so the term is the part before the crew and
   * the crew is marked as the people they are — each with their own Funktion, and on a crew row
   * the first of them badged as the Gruppenführer (linkMarkup · crewRow). Whole-word matching
   * keeps «Trupp 1» out of «Trupp 10». The Gruppenführer's name rides along as the chip's hint,
   * so the composer's suggestion reads «Trupp 1 · Meier Anna» and nobody has to know the number.
   *
   * ⚠️ The LEGACY term stays beside it, WITH the word in front, which is what made it a term at
   * all: a Trupp carried no number, its name IS its Gruppenführer's (types · Trupp.name), and
   * that name is already in the vocabulary as a person. Bare, the two entries would fight over
   * the same letters and the Trupp would never win a single range. With the word it is longer
   * than the person's name, so «Trupp Meier Anna» marks as the Trupp and a bare «Meier Anna»
   * still marks as her — and it is the spelling every row before 12.09. used, and those rows
   * stay as written.
   *
   * ⚠️ EVERY Trupp, `raus` and taken off the board included. The Verlauf is a record: a row from
   * two hours ago names a Trupp that has since come out, and a term that stopped being marked
   * when the crew finished would leave the printed Rapport marking the first half of the Einsatz
   * and not the second. Being live only decides ORDER — `present` is what breaks a tie between
   * two equally good matches in the composer's suggestions (lib/journalEntry · suggestLinks).
   *
   * The `role` is the Gruppenführer's own Funktion, matched by name so a Gast leading a Trupp
   * gets it too: the row then reads «Trupp Brunner Thomas (AS-GF) / Müller Hans (AS)», which is
   * what the suffix said before the Trupp term existed to swallow that first name.
   */
  const roleOfName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p.role]))
  const seenTeam = new Set<string>()
  const teams: JournalLink[] = (trupps ?? []).flatMap((t) => {
    const lead = (t.name ?? '').trim()
    const present = !t.removedAt && t.status !== 'raus'
    const out: JournalLink[] = []
    // the numbered term — no `role`: the leader follows in the row as a person of their own,
    // and prints their Funktion there
    if (typeof t.no === 'number') {
      const name = fillTemplate(appConfig.copy.atemschutz.truppTerm, { name: String(t.no) })
      if (!seenTeam.has(name)) { seenTeam.add(name); out.push({ name, kind: 'trupp', present, hint: lead || undefined, truppId: t.id }) }
      // …and the numbers a merge took from it (docs/trupp-naming.md §7): its early rows say those,
      // and in a row about THIS Trupp they are this Trupp — see JournalLink.former
      const now = [name, lead].filter(Boolean).join(' · ')
      for (const n of Array.isArray(t.formerNos) ? t.formerNos : []) {
        if (typeof n !== 'number' || n === t.no) continue
        out.push({ name: fillTemplate(appConfig.copy.atemschutz.truppTerm, { name: String(n) }), kind: 'trupp', present, hint: now, truppId: t.id, former: true })
      }
    }
    // the legacy term, for every row written before 12.09. — two Trupps under the same
    // Gruppenführer (a re-registration) are one term, not two chips
    const legacy = lead ? fillTemplate(appConfig.copy.atemschutz.truppTerm, { name: lead }) : ''
    if (legacy && !seenTeam.has(legacy)) {
      seenTeam.add(legacy)
      out.push({ name: legacy, kind: 'trupp', present, role: roleOfName.get(lead.toLowerCase()) })
    }
    return out
  })
  const materials: JournalLink[] = (cfg.mittel?.catalogue ?? [])
    .map((m) => ({ name: m.label, kind: 'material' as const }))
  const partners: JournalLink[] = (cfg.report?.partnerOrgs ?? [])
    .map((o) => ({ name: o, kind: 'partner' as const }))
  const vehicles: JournalLink[] = (cfg.fleet?.vehicles ?? [])
    .map((v) => ({ name: v.label, kind: 'vehicle' as const }))
  // «Gr. 1 (Kdo)» is how the Rapport names a group, so that is the form the journal links to
  const groups: JournalLink[] = (cfg.alarms?.groups ?? [])
    .map((g) => ({ name: g.color ? `${g.label} (${g.color})` : g.label, kind: 'group' as const }))
  const heldAt = new Map(Object.entries(attendance).flatMap(([id, a]) => (a.noteAt ? [[id, a.noteAt] as const] : [])))
  return [...commandRoles(people, heldAt), ...people, ...teams, ...materials, ...partners, ...vehicles, ...groups,
    ...plainTerms()]
    .filter((l) => !!l.name?.trim())
}

/**
 * The shipped national spelling help: the Funk abbreviations and the Geschosse
 * (appConfig.journal · abbreviations / locations).
 *
 * ⚠️ LAST in the vocabulary, and that is deliberate. `suggestLinks` breaks a tie between equal
 * matches by presence and then by the list's own order, so an abbreviation can never push a
 * person who is standing on the Schadenplatz off the chip row: «GF» reaches the Gruppenführer
 * abbreviation only once no name is a better answer for those letters.
 * ⚠️ `plain` — see JournalLink.plain. Nothing here is ever marked.
 */
function plainTerms(): JournalLink[] {
  const J = appConfig.journal
  return [
    // the long form is the CHIP's hint (JournalLink.hint): shown while choosing, never inserted
    // and never printed — which is what lets the record keep the spoken «Hösi».
    ...J.abbreviations.map((a) => ({ name: a.term, kind: 'term' as const, hint: a.long, plain: true })),
    ...J.locations.map((l) => ({ name: l, kind: 'term' as const, plain: true })),
  ]
}

/**
 * «EL» and «Stv. EL» as words of their own.
 *
 * A Verlauf is a Funkprotokoll, and its most-written participant is a POST, not a name: «EL →
 * Sanität: Patient stabil». Written as plain prose those two letters were the only thing in such
 * a line that was not a link — the one term the record could not resolve, for the one job that
 * decides everything on the Schadenplatz.
 *
 * ⚠️ The name rides along as the `role` suffix, which is the same mechanism reversed: a person's
 * entry prints «Widmer Céline (EL)», the post's entry prints «EL (Widmer Céline)». Both directions
 * of the same fact, so it does not matter which way round the operator writes the sentence.
 * ⚠️ And when nobody holds the post — the first minutes, an exercise, a Nachbarwehr's copy — the
 * term stays, without a suffix. «EL» is then still what was said; there is simply nobody yet to
 * name. Dropping the term instead would make the marking come and go with the Anwesenheit.
 * ⚠️ Resolved at RENDER time, like every other role suffix, so an Ablösung re-labels older rows
 * too. The row's own `text` — the record, the hash chain, the paper — never changes.
 */
function commandRoles(people: JournalLink[], heldAt?: Map<string, string>): JournalLink[] {
  const A = appConfig.copy.anwesenheit
  return [A.roleEinsatzleiterShort, A.roleEinsatzleiterStvShort]
    .filter((short) => !!short?.trim())
    .map((short) => {
      // ⚠️ The one who took it on LAST. A handover leaves the previous EL's Bemerkung standing
      // (the app warns, it does not overwrite what somebody wrote), so «find the first» answered
      // with whoever the roster sort happened to put on top — and the journal could name a person
      // who handed over an hour ago. Entries with no stamp sort last: they are the old ones.
      const holder = people
        .filter((p) => p.role === short)
        .sort((a, b) => (heldAt?.get(b.id ?? '') ?? '').localeCompare(heldAt?.get(a.id ?? '') ?? ''))[0]
      return {
        name: short, kind: 'person' as const, id: holder?.id, present: holder?.present,
        role: holder?.name,
        // marks this as a POST rather than a thing — see JournalLink.word. (It used to be what
        // kept «el» out of Melder, Schnellangriff, Winkel and Keller; word boundaries are the
        // rule for every term now.)
        word: true,
      }
    })
}

/**
 * The Bemerkung, shortened for a line of prose.
 *
 * «Einsatzleiter» inside a sentence that already names the person is four syllables of the
 * reader's attention for one letter of information, and the Verlauf is read in a hurry. The
 * doctrine words get their abbreviations; everything else («Fahrer TLF», «Verkehrsdienst») is
 * already short and stays exactly as it was typed — the Bemerkung is the operator's wording and
 * nothing here is entitled to rewrite it.
 */
function shortRole(note: string): string | undefined {
  if (!note) return undefined
  const A = appConfig.copy.anwesenheit
  const truppLeader = fillTemplate(A.roleLeader, { role: A.roleTrupp })
  const parts = note.split(',').map((p) => p.trim()).filter(Boolean)
    .map((p) => {
      if (p === A.roleEinsatzleiter) return A.roleEinsatzleiterShort
      if (p === A.roleEinsatzleiterStv) return A.roleEinsatzleiterStvShort
      // ⚠️ «(Trupp)» is dropped and «(Trupp-GF)» shortened to «GF» (04.09., Manuel's Rapport).
      // On the Anwesenheitsliste those two words earn their place: they are what tells an AdF who
      // was in a Trupp from one who stayed at the Magazin. In a Verlauf row they cannot — the row
      // is ABOUT a Trupp, and «Trupp Brunner Thomas (Trupp) / Müller Hans (Trupp)» says the same
      // word three times. What is still worth printing there is who led it. The Atemschutz
      // variants stay whole: «(AS)» beside a name in a row about something else is news.
      if (p === A.roleTrupp) return ''
      if (p === truppLeader) return appConfig.copy.atemschutz.leaderBadge
      return p
    })
    .filter(Boolean)
  return parts.join(', ') || undefined
}

/** One marked stretch of an entry's text. */
export interface LinkRange {
  start: number
  end: number
  kind: MarkKind
  /** the job the named person holds — set on the FIRST mention in this text only */
  role?: string
  /** what to open — the absolute address for a `url`, the `tel:` number for a `phone`, and
   *  nothing for every other kind. Resolved here rather than at every render site, so a bare
   *  «www.…» gets its scheme and a spaced-out number its dialable form in exactly one place. */
  href?: string
  /** the Trupp a `trupp` mark names (JournalLink.truppId) */
  truppId?: string
  /** what a FORMER number is called now («Trupp 3 · Meier Anna») — JournalLink.former */
  hint?: string
}

/**
 * Where the vocabulary appears in a piece of text.
 *
 * Longest first, so «Meier Anna» wins over a «Meier» that is a prefix of it and the two can
 * never overlap. Case-insensitive, because an entry typed at 3am is not typed carefully — but
 * the MATCH is on the canonical spelling, so what gets marked is only ever a real name.
 *
 * ⚠️ WHOLE WORDS, every kind of them (04.09.). This used to be opt-in per term — on for «EL»,
 * off for names, Partnerorganisationen, Fahrzeuge and Gruppen, on the reasoning that a name is
 * long enough to be unmistakable — and the 03.09. Rapport printed «Kantonspolizei» with
 * «polizei» bolded inside the word, which reads as the app naming the wrong organisation. A term
 * only counts with nothing word-ish on either side of it. Case still does not matter: a
 * tablet-typed «tlf» is the Fahrzeug, and it is a whole word either way.
 *
 * ⚠️ Addresses are found FIRST and keep what they claim. A Fahrzeug called «TLF» must not bold
 * up in the middle of a link: it would break the address on paper and split the anchor on
 * screen, for a match that was never the Fahrzeug in the first place. Phone numbers come next,
 * for the same reason in the other direction: the digits inside an already-claimed address are
 * part of it, never a number to dial.
 */
export function linkRanges(text: string, vocab: JournalLink[], opts?: MarkOptions): LinkRange[] {
  const out: LinkRange[] = urlRanges(text)
  const overlaps = (a: number, b: number) => out.some((r) => a < r.end && r.start < b)
  if (opts?.phone) for (const r of phoneRanges(text)) if (!overlaps(r.start, r.end)) out.push(r)
  const hay = text.toLowerCase()
  const subject = opts?.subjectId
  // a Trupp's former number marks only in a row about that Trupp (JournalLink.former); longest
  // first, and at equal length the row's own subject first — the row is linked by id
  const own = (l: JournalLink) => (subject && l.truppId === subject ? 0 : 1)
  const usable = vocab.filter((l) => !l.former || (!!subject && l.truppId === subject))
  for (const l of usable.sort((a, b) => b.name.length - a.name.length || own(a) - own(b))) {
    // spelling help completes but never marks — see JournalLink.plain
    if (l.plain) continue
    const needle = l.name.trim().toLowerCase()
    if (needle.length < 2) continue
    let from = 0
    // ⚠️ ONCE per entry. «Widmer Céline (EL) meldet … Widmer Céline (EL) übernimmt» is the same
    // fact printed twice in one sentence, and a row that repeats itself reads as a bug.
    let roleSaid = false
    for (;;) {
      const i = hay.indexOf(needle, from)
      if (i < 0) break
      const end = i + needle.length
      // …with nothing word-ish on either side of it: «EL» is two letters and lit up in Melder,
      // Keller and Schnellangriff, and «Polizei» lit up inside «Kantonspolizei».
      if (isWordChar(hay[i - 1]) || isWordChar(hay[end])) { from = i + 1; continue }
      if (!overlaps(i, end)) {
        out.push({ start: i, end, kind: l.kind, role: roleSaid ? undefined : l.role, ...(l.former ? { hint: l.hint } : {}), ...(l.truppId ? { truppId: l.truppId } : {}) })
        roleSaid = true
      }
      from = end
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Letters (incl. umlauts and accents) and digits — what a word may not be glued to. */
function isWordChar(ch: string | undefined): boolean {
  return ch != null && /[\p{L}\p{N}]/u.test(ch)
}

/**
 * The addresses in a piece of text — the web ones, the e-mail ones, and the bare domain.
 *
 * Three passes, in the order a longer claim has to beat a shorter one: a full `https://…` or the
 * `www.…` every printed Merkblatt still uses, then e-mail, then the bare `vkf.ch` — the host of a
 * URL and the domain of an address are both a bare domain, so anything already claimed is left
 * alone. The short forms keep their short spelling on screen and on paper (the entry prints what
 * was said); the scheme is added in the `href` only.
 *
 * ⚠️ The bare domain is gated on a KNOWN-TLD list and nothing else (04.09.). A Verlauf is full of
 * text with dots in it that is not an address — «z.B.», «Version 1.2.3», «01.09.2026», a sentence
 * typed without the space after its full stop — and a matcher that guesses puts a dead link into
 * the legal record. The list is the handful this Wehr actually sees; anything else has to be
 * written with its `www.` or its scheme, which is what people do anyway.
 */
const KNOWN_TLDS = ['swiss', 'info', 'com', 'org', 'net', 'eu', 'ch', 'de', 'at', 'fr', 'it']
/** …one label, then more of them, then one of the TLDs above, and nothing word-ish behind it. */
const DOMAIN = String.raw`(?:[\p{L}\p{N}][\p{L}\p{N}-]*\.)+(?:${KNOWN_TLDS.join('|')})(?![\p{L}\p{N}])`
/** what may FOLLOW a host and still belong to it — the excluded characters are the ones that
 *  would break the printed markup (see below) */
const URL_PATH = String.raw`(?:[/?#][^\s<>"«»]*)?`

function urlRanges(text: string): LinkRange[] {
  const out: LinkRange[] = []
  const claim = (start: number, raw: string, href: string) => {
    const end = start + raw.length
    if (out.some((r) => start < r.end && r.start < end)) return
    out.push({ start, end, kind: 'url', href })
  }
  // ── 1. what somebody wrote out in full ──
  // ⚠️ The excluded characters are not cosmetic: `"` is what closes the href attribute in the
  // printed markup, and `<`/`>` what would open a tag inside it.
  const re = /(?:https?:\/\/|www\.)[^\s<>"«»]+/gi
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    // «…undwww.vkf.ch» is a missing space, not an address the writer meant to leave there
    if (isWordChar(text[m.index - 1])) continue
    const raw = trimUrlTail(m[0])
    // a bare scheme, or a «www.» with nothing behind it, is somebody half-way through typing
    if (!/^(?:https?:\/\/|www\.)[^\s/?#]/i.test(raw)) continue
    claim(m.index, raw, /^www\./i.test(raw) ? `https://${raw}` : raw)
  }
  // ── 2. e-mail: the other address a Meldung leaves behind, and the one nobody can dial ──
  // BEFORE the bare domain, or the half behind the «@» would be claimed as a website.
  const mail = new RegExp(String.raw`[\p{L}\p{N}._%+-]+@${DOMAIN}`, 'giu')
  for (let m = mail.exec(text); m !== null; m = mail.exec(text)) {
    const raw = trimUrlTail(m[0])
    claim(m.index, raw, `mailto:${raw}`)
  }
  // ── 3. the bare domain ──
  const bare = new RegExp(DOMAIN + URL_PATH, 'giu')
  for (let m = bare.exec(text); m !== null; m = bare.exec(text)) {
    // glued to a word, a dot, an «@» or a dash it is the tail of something longer — a local part
    // whose address failed the TLD gate, a filename, a hostname already claimed above
    const prev = text[m.index - 1]
    if (isWordChar(prev) || prev === '.' || prev === '@' || prev === '-' || prev === '/') continue
    const raw = trimUrlTail(m[0])
    claim(m.index, raw, `https://${raw}`)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Punctuation that ends a sentence rather than an address — «Merkblatt unter www.vkf.ch.» is a
 *  full stop, «(www.vkf.ch)» a bracket the writer opened. Both are prose, and neither belongs in
 *  the href or in the underline. The German quotes are not in this list because the match above
 *  never takes them in the first place. */
const URL_TAIL = '.,;:!?)'

/**
 * …trimmed off the end, with the one exception every link-detector needs: a «)» that closes a
 * «(» the address itself contains stays part of it (the Wikipedia case,
 * `…/wiki/Nirvana_(Band)`). Counting brackets over the candidate is what tells the two apart —
 * a link the writer put in brackets has the closer without an opener.
 */
function trimUrlTail(url: string): string {
  let end = url.length
  for (; end > 0; end--) {
    const ch = url[end - 1]
    if (!URL_TAIL.includes(ch)) break
    const head = url.slice(0, end)
    if (ch === ')' && head.split('(').length >= head.split(')').length) break
  }
  return url.slice(0, end)
}

/**
 * The Swiss phone numbers in a piece of text.
 *
 * ⚠️ Deliberately ONE shape, and a narrow one: the ten digits of a Swiss number, written either
 * nationally («079 123 45 67», «044 123 45 67») or internationally («+41 79 123 45 67»), grouped
 * 3-3-2-2 the way the Post writes them, with a space, «/», «.» or «-» between the groups or
 * nothing at all («0791234567»). Everything else stays prose. A Verlauf is FULL of numbers that
 * are not numbers to call — «14:31» (the colon is not a separator here), «250 bar», «Leitung 3»,
 * «01.09.2026» (eight digits, and neither half is three long) — and a matcher that guesses wrong
 * puts a dead tap target in the middle of the legal record. What this does not take: the short
 * emergency numbers (118/144 are three digits and unmistakable on paper anyway), «00 41 …», and
 * the «+41 (0)79» form, whose bracketed zero has to be dropped from the href rather than dialled.
 */
function phoneRanges(text: string): LinkRange[] {
  // `0` + area code, or «+41» + the same code without its zero, then 3-2-2
  const re = /(?:\+41[ ./-]?|0)\d{2}[ ./-]?\d{3}[ ./-]?\d{2}[ ./-]?\d{2}/g
  const out: LinkRange[] = []
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const end = m.index + m[0].length
    // ⚠️ Glued to a letter or another digit it is a longer number (an Einsatz-ID, a Zählerstand,
    // a bank reference) that happens to contain ten digits — not a number anybody dials. The
    // leading «+» is checked separately: it never survives `isWordChar`.
    if (isWordChar(text[m.index - 1]) || text[m.index - 1] === '+' || isWordChar(text[end])) continue
    // dialable: digits only, keeping the country code's «+». The printed text stays exactly as
    // the operator typed it — the Rapport prints what was said, spacing included.
    out.push({ start: m.index, end, kind: 'phone', href: `tel:${m[0].replace(/[^\d+]/g, '')}` })
  }
  return out
}

/** One stretch of an entry as it gets rendered — plain, or marked. */
export interface LinkPart {
  text: string
  kind?: MarkKind
  /** the job the named person holds, on their first mention */
  role?: string
  /** where a `url` or a `phone` part points (see LinkRange.href) */
  href?: string
  /** see LinkRange.truppId / LinkRange.hint */
  truppId?: string
  hint?: string
}

/** The text split into plain stretches and marked ones — one shape the composer's backdrop, the
 *  Verlauf and the Wiedergabe all render from, so no two of them can mark different things. */
export function linkParts(text: string, vocab: JournalLink[], opts?: MarkOptions): LinkPart[] {
  const ranges = linkRanges(text, vocab, opts)
  const parts: LinkPart[] = []
  let at = 0
  for (const r of ranges) {
    if (r.start > at) parts.push({ text: text.slice(at, r.start) })
    parts.push({ text: text.slice(r.start, r.end), kind: r.kind, role: r.role, href: r.href, truppId: r.truppId, hint: r.hint })
    at = r.end
  }
  if (at < text.length) parts.push({ text: text.slice(at) })
  return parts
}

/**
 * Is this person's Funktion a GRUPPENFÜHRER's, and what does a crew row call it?
 *
 * The note may hold several jobs («AS-GF, Fahrer PIO»), and the leader half is spelled per Art
 * («AS-GF», «Trupp-GF» — copy · anwesenheit.roleLeader) or has already been trimmed to the bare
 * badge for a plain Trupp (see `shortRole`). Any of them means the same thing on a crew row, and
 * there it is printed as the badge alone: the row is about that Trupp, so «AS» is what everybody
 * in it is.
 */
function crewLeaderBadge(role: string): string | undefined {
  const A = appConfig.copy.anwesenheit
  const badge = appConfig.copy.atemschutz.leaderBadge
  const leaderWords = [A.roleAtemschutz, A.roleTrupp]
    .map((r) => fillTemplate(A.roleLeader, { role: r }).toLowerCase())
    .concat(badge.toLowerCase())
  return role.split(',').map((p) => p.trim().toLowerCase()).some((p) => leaderWords.includes(p))
    ? badge : undefined
}

/**
 * Marked-up text for the PRINTED journal: every named term in bold, every address and every phone
 * number underlined and anchored. The Rapport has no colour to spend — bold is what a reader
 * already reads as «this is a name», and an underline what they read as «this can be followed».
 * The PDF's own reader turns the anchor into a tap — a `tel:` one straight into a call, which is
 * the whole point of the callback number a Meldung leaves in the entry text; on paper the address
 * and the number are still written out, which is why the text and not a label gets printed.
 *
 * ⚠️ This is the ONE place phone numbers are marked (`MarkOptions.phone`): the on-screen Verlauf
 * stays text-only on them, deliberately — see `MarkOptions`.
 *
 * `esc` is the caller's XML escaping and is applied to the href as well — an address can carry
 * an «&» between its query parameters, and one unescaped ampersand costs the whole page.
 *
 * ⚠️ Returns `undefined` when the row marked nothing at all, so the backend falls back to its own
 * escaping of the plain text rather than storing markup that says nothing (see report.ts).
 */
export function linkMarkup(
  text: string, vocab: JournalLink[], esc: (s: string) => string,
  /**
   * `crewRow`: this row ENUMERATES a Trupp — «Trupp Brunner Thomas / Müller Hans / Schmid Peter
   * angemeldet» (04.09., Feldtest Manuel).
   *
   * There, only the Gruppenführer keeps a suffix, and it is the bare «GF». Every other Funktion
   * on that line — «(AS)», «(Stv. Einsatzleiter, AS)» — says about one person what the row
   * already says about all of them, three or four times in one sentence, on the one surface with
   * no room to spare. The SCREEN keeps them all: there the names are tappable people, and the
   * suffix is what tells you which one you are about to open.
   *
   * ⚠️ On such a row the FIRST name marked is the Gruppenführer, and it is badged whether or not
   * anybody ever wrote a Funktion on the Anwesenheit (the reported bug, 11.09.). «First name»
   * counts the legacy «Trupp Meier Anna» term (it IS the leader's name) and every person; the
   * numbered «Trupp 1» term is not a name and is skipped over. The badge used
   * to be read off the Anwesenheits-Bemerkung alone, so «Trupp Müller Hans (GF) / Meier Anna:
   * Eintritt» and «Trupp Keller Laura / Frei Nina: Druck 280 bar» printed side by side on one
   * Rapport — the second crew's leader simply had no «AS-GF» on the roster (a Gast, or a job
   * nobody typed), and the row lost the one fact it is read for.
   *
   * The position IS the record: every crew-enumerating row is written leader-first
   * (lib/atemschutz · truppLogName), so the first name in THAT TEXT is who led the Trupp at THAT
   * moment — which is also why this must stay a display-time read of the row rather than today's
   * `Trupp.name` stamped onto an hour-old line.
   */
  opts?: { crewRow?: boolean },
): string | undefined {
  const parts = linkParts(text, vocab, { phone: true })
  if (!parts.some((p) => p.kind)) return undefined
  let leadSaid = false
  return parts
    .map((p) => {
      if (!p.kind) return esc(p.text)
      if (p.kind === 'url' || p.kind === 'phone') {
        return `<a href="${esc(p.href ?? p.text)}"><u>${esc(p.text)}</u></a>`
      }
      let role = p.role
      // a numbered Trupp term («Trupp 1») is not a name — the leader is the next person marked
      if (opts?.crewRow && !(p.kind === 'trupp' && /\d$/.test(p.text))) {
        const lead = !leadSaid
        leadSaid = true
        role = (p.role ? crewLeaderBadge(p.role) : undefined)
          ?? (lead ? appConfig.copy.atemschutz.leaderBadge : undefined)
      }
      // the job in plain weight after the bold name: it is context for the name, not a second name
      return role ? `<b>${esc(p.text)}</b> (${esc(role)})` : `<b>${esc(p.text)}</b>`
    })
    .join('')
}

/** One chip offered right AFTER something was accepted — see `suggestNext`. */
export interface NextChip {
  /** what the chip says */
  label: string
  /** what gets APPENDED to the sentence. A term carries its own trailing space (the caret goes
   *  on writing after it, exactly as `acceptName` leaves it); a Textbaustein ends the clause and
   *  does not. */
  insert: string
  /** a word of this Einsatz's vocabulary, or one of the station's Textbausteine */
  source: 'term' | 'phrase'
  /** for a term: which kind, so the chip wears the same tint the name suggestions do */
  kind?: LinkKind
}

/** A handful — the row scrolls sideways, but what is worth reading at 3am is the first few. */
const NEXT_LIMIT = 4

/** Continuations observed after the last completed term in this Einsatz. An arrow keeps its
 * speaker as the anchor and only learns recipients written in the same arrow direction. */
export function suggestNext(
  text: string,
  opts: {
    vocab: JournalLink[]
    /** the station's Textbausteine (deployment config journal.quickPhrases over the defaults) */
    phrases: readonly string[]
    /** this Einsatz's own rows — the only evidence there is */
    timeline: readonly TimelineEvent[]
    limit?: number
  },
): NextChip[] {
  const { vocab, phrases, timeline, limit = NEXT_LIMIT } = opts
  const arrow = text.trimEnd().match(/[→←]$/)?.[0]
  const anchor = endingTerm(arrow ? text.trimEnd().slice(0, -1) : text, vocab, phrases)
  if (!anchor) return []
  // the rows of this Einsatz that name the anchor. Filtered FIRST, so the expensive pass below
  // runs over a handful of rows rather than over the whole record on every keystroke.
  const rows = timeline.filter((e) => e.text && containsTerm(e.text, anchor))
  if (!rows.length) return []

  // ⚠️ Order is the tiebreak, and terms come before phrases in it: two candidates seen equally
  // often should offer the WORD of this Einsatz first — it is the one the operator cannot spell
  // from memory, which is the whole reason the vocabulary is offered at all.
  const seen = new Set<string>([anchor.toLowerCase()])
  const candidates: NextChip[] = []
  for (const l of vocab) {
    const name = l.name?.trim()
    if (!name || name.length < 2 || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    candidates.push({ label: name, insert: `${name} `, source: 'term', kind: l.kind })
  }
  for (const p of phrases) {
    const phrase = p.trim()
    if (!phrase || seen.has(phrase.toLowerCase())) continue
    seen.add(phrase.toLowerCase())
    candidates.push({ label: phrase, insert: phrase, source: 'phrase' })
  }

  const counts = new Map<string, number>()
  const anchorIsTerm = vocab.some((l) => l.name.toLowerCase() === anchor.toLowerCase())
  for (const row of rows) {
    const found = new Set<string>()
    const positions = anchorIsTerm
      ? linkRanges(row.text, vocab).filter((r) => row.text.slice(r.start, r.end).toLowerCase() === anchor.toLowerCase()).map((r) => r.start)
      : termPositions(row.text, anchor)
    for (const at of positions) {
      let after = row.text.slice(at + anchor.length)
      if (arrow) {
        if (!after.trimStart().startsWith(arrow)) continue
        after = after.trimStart().slice(1).trimStart()
      }
      const following = candidates
        .filter((c) => !arrow || c.source === 'term')
        .map((c, i) => ({ c, i, at: termPositions(after, c.label)[0] ?? -1 }))
        .filter((m) => m.at >= 0 && (!arrow || m.at === 0))
        // Stop between sentences, but retain punctuation inside a known term such as «Stv. EL».
        .filter((m) => !/\n|[.!?;](?:\s|$)/.test(after.slice(0, m.at)))
        .sort((a, b) => a.at - b.at || b.c.label.length - a.c.label.length || a.i - b.i)[0]
      if (following) found.add(following.c.label)
    }
    for (const label of found) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return candidates
    .filter((c) => !containsTerm(text, c.label))
    .map((c, i) => ({ c, i, n: counts.get(c.label) ?? 0 }))
    .filter((m) => m.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, Math.max(0, limit))
    .map((m) => m.c)
}

/**
 * The term the sentence currently ENDS on — with or without the space after it, and nothing else
 * behind it. That is the one moment a continuation is an answer rather than an interruption: mid
 * word the fragment has better ones (names, Textbausteine), and further into the sentence the
 * chip would be a row that never goes away.
 *
 * A vocabulary word first (the same test the «→» is offered on, addresses excluded — «www.vkf.ch»
 * is nobody the sentence is about), then a Textbaustein the text ends with, longest first.
 */
function endingTerm(text: string, vocab: JournalLink[], phrases: readonly string[]): string | null {
  const end = text.trimEnd()
  if (!end) return null
  const last = linkParts(end, vocab).pop()
  if (last?.kind && last.kind !== 'url' && last.kind !== 'phone') return last.text
  const lower = end.toLowerCase()
  return [...phrases]
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && lower.endsWith(p.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0] ?? null
}

/** Does this text carry that term as a WHOLE word? The same rule `linkRanges` marks by — «Polizei»
 *  must not count inside «Kantonspolizei» — but asked about one term, so it costs one scan. */
function containsTerm(text: string, term: string): boolean {
  return termPositions(text, term).length > 0
}

function termPositions(text: string, term: string): number[] {
  const hay = text.toLowerCase()
  const needle = term.trim().toLowerCase()
  const positions: number[] = []
  if (needle.length < 2) return positions
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    if (!isWordChar(hay[i - 1]) && !isWordChar(hay[i + needle.length])) positions.push(i)
  }
  return positions
}
