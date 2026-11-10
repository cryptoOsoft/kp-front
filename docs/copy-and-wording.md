# Copy and wording

Where UI text lives and which word a screen uses: the copy mechanics (`src/config/copy/`, German
first, all four locales), then the wording decisions that apply across surfaces. Moved here from
AGENTS.md on 2026-10-08 (the wording) and 2026-10-18 (the mechanics), wording unchanged.

## Copy mechanics and language

- **Domain language is German** (Atemschutz, Trupp, Einsatz, Verlauf, …); keep terms
  accurate. **All user-facing strings live in `appConfig.copy.*`** – never hard-code UI text in
  a component; add a key and reference it.
- **Prose language split: technical English, user-facing German.** Everything technical –
  `docs/`, READMEs, `CHANGELOG.md`, code comments, commit messages – is written in English;
  German appears there only as domain terms and as «quoted» UI copy. User-facing text is German
  with i18n overlays (below). The gitignored internal station documents under `docs/` are the
  exception and may stay German.
- **i18n / multilingual copy lives in `src/config/copy/`.** German (`de.ts`, assembled from one
  module per surface in `de/<surface>.ts`) is the canonical base and the source of the `Copy`
  type; `en.ts` (full) / `fr.ts` / `it.ts` (each split the same way) are
  `Localizable<Copy>` partial overlays **deep-merged over German**, so any missing key falls
  back to the German string – a half-translated locale is always complete. `appConfig.copy` is
  a **getter** returning the active locale's catalogue (`copy/getCopy()`); read sites are
  unchanged (`appConfig.copy.x.y`). Locale is a **per-deployment** setting (one brigade = one
  language), resolved **once at boot** (`/api/config` `identity.locale` → `de-CH`) by
  `applyLocale()` in `main.tsx`. It's set in deployment config (CLI/config file first; admin UI
  can inspect/basic-edit Station › Identität › Sprache), NOT per device – except on the public
  demo (`identity.demoMode`), where the login card and Einstellungen › Gerät let a device pick
  Deutsch or Français (`lib/demoLocale`). **Add a new string to
  `de/<surface>.ts` first** (it defines the shape); translate in the other locales as desired.
  Two caveats: (1) module-level captures like `const C = appConfig.copy.x` freeze the language
  at import – read inside the component/function instead; (2) a few copy values are structural
  DATA keys, not labels (`contextPanel.unField`/`stoffField` match the non-localized preset
  fields, intake `kategorien` mirrors the backend) – leave these untranslated
  (German fallback).
- Help text is per device (`lib/helpDevice`).

## Removing is «Entfernen», «gelöscht» is a Feuer

⚠️ **The two acts never share a verb** (decided 25.09.2026): taking a tactical object off the
picture is «Entfernen» / «… entfernt» — button, confirm and Verlauf row, Karte and Plan, every
object kind (`copy · remove`, `log.objectDeleted` …) — so «gelöscht» only ever means an
extinguished Feuer. That holds for EVERYTHING on the picture (audited 25.09.2026 after the second
staging walk-through): a Trupp taken off the board («Trupp N entfernt»), a marker's Spur, a
Gebäude storey («Geschoss 3. OG entfernt», now written by the act itself), a plan group — pinned
by `config/copy/removalWords.test.ts`. Rows already written keep their «gelöscht»
(append-only). «Löschen» stays for records that are not on the picture (an Ansicht, a Schicht,
a Checkliste, a Verlauf-Eintrag, a Mittel line).

## Words

- **The map surface is «Karte», the printed picture is «Kroki» – user-facing copy no longer says
  «Lage»** (2026-09-01). The word meant three things at once (the surface you draw on, the
  tactical picture that gets printed, and the doctrinal *Lage* of an Einsatz), so a row could
  read «auf der Lage platziert» while the tab beside it said «Karte» and the Rapport column said
  «Kroki». The rule now: the surface and everything about placing things on it is **Karte**; the
  rendered/printed snapshot is **Kroki** (the Rapport's `areaLage` value has said so since
  10.08.); real doctrine compounds – *Lage- und Einsatzführung*, *Lagebeurteilung*, *Lagerapport*
  – keep their word, because they are the fire service's terms and not ours. ⚠️ Code identifiers
  are NOT part of this: `mode 'map'`, `surface: 'map'`, `areaLage`, `placeLage`, `lagePickSub`
  and friends keep their names, and so does `alarmText.ts`'s `LINK_PREFIX = 'Lage & Pläne:'`,
  which is a **wire literal** matching what the external alerting gateway (fwo-divera ·
  `src/api/sms.py`) emits – renaming it would break link extraction on every real alarm.
- **A storey is a «Geschoss», the Plan surface an «Arbeitsfläche» – never «Stockwerk» or
  «Whiteboard» in user-facing copy** (2026-09-23: the controls, the Plan stack, the admin and
  OG/UG already said Geschoss while the help and the Verlauf rows said Stockwerk). Already-written
  Verlauf rows keep their wording (append-only); code identifiers (`floor`, `floorTag`,
  `whiteboard.*`, `Whiteboard.tsx`) keep their names.
- **The place is «Verlauf», the thing is «Eintrag» – on every screen** (29.09.2026). The composer
  is «Neuer Eintrag», its toast «Eintrag erfasst», the checklist action chip «Verlauf», the
  Führungsansicht «Verlauf & Symbol-Details», the detail sheet's meta line «… · von Hand erfasst». «Journal» appears
  on screen nowhere. **«Einsatzjournal» stays ONLY as the printed Rapport section's name**
  (`app/report · "journal"`, `copy.report.journal`, and the «Abschnitte» toggle that names that
  section) – the paper term. The printed Atemschutz section is «Atemschutzüberwachung», never
  «Atemschutz-Journal». en/fr/it keep their own place word (Log / Journal / Diario) and the same
  entry word (Entry / Entrée / Voce). Code identifiers (`journal.*`, `Journal.tsx`, `jr-*`,
  `jc-*`) keep their names. **One count, one word: «{n} anwesend»** – the chooser, the
  Anwesenheit head and the Rapport's «Personal & Mittel» row say the same word for the head
  count (the Rapport said «erfasst»).

## Failure, clear and search copy

- **Failure copy has two shapes, and they are not interchangeable** (settled 2026-08-27 after a
  sweep found 35 of one and 20+ of the other with no rule between them):
  - *«X fehlgeschlagen»* – the action the operator just triggered failed, on a surface that
    already says which one it was (the toast right after the button). It is a **fragment**.
  - *«X konnte nicht … werden»* – the failure is about a **named thing** the operator did not
    just act on, or the sentence has to carry *which* object failed («Plan konnte nicht
    hochgeladen werden»). Losing the object name to shorten it is the wrong trade.
  - **Punctuation follows the last segment, not the string.** A string ends with a period only
    when its final segment is a full clause (subject + finite verb): «… – Änderungen sind lokal
    gespeichert.» keeps it, «Löschen fehlgeschlagen» does not.
    Headings and titles never take one, even when they are full clauses («Ein Fehler ist
    aufgetreten»). The rule is per locale – French «La suppression a échoué.» is a clause where
    German «Löschen fehlgeschlagen» is a fragment, and both are right.
  - **A retry sentence says what happened, the button says «Erneut versuchen»** (29.09.2026) —
    never «… nochmals versuchen» in the sentence next to it; one button word in every locale.
- **A ✕ that empties a field says «leeren», never «löschen»** (29.09.2026) — «löschen» is the
  delete verb. `copy.clear` «Leeren», `copy.clearSearch` «Suche leeren»; no per-surface «Suche löschen» copies.
- **A search field's placeholder is «<Thing> suchen …», or bare «Suchen …» where the surface
  already names the thing** (swept 18.09.2026: «Suchen», «Name suchen», «Suchen oder Name
  eingeben …» and three-dot `...` all existed side by side). Always the ellipsis character with a
  space before it, in every locale. A string that serves only as `aria-label`/button text is
  the plain infinitive («Im Verlauf suchen»); a key used for BOTH keeps the placeholder form.
