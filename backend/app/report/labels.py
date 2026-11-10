"""The Rapport's German labels and write-in stubs.

Split out of the former ``report_pdf.py``; rules for this area: docs/rapport.md.
"""

from __future__ import annotations

# ----------------------------------------------------------------------------- German labels

L = {
    "eyebrow": "Einsatzrapport",
    "keyword": "Stichwort",
    "category": "Kategorie",
    "exercise": "ÜBUNG — kein Ereignis",
    "address": "Adresse / Objekt",
    "einsatzleiter": "Einsatzleiter",
    "kontaktperson": "Kontaktperson",
    "kontaktpersonTelefon": "Telefon",
    "alarmierung": "Alarmierung",
    "ausgerueckt": "Ausgerückt",
    "incidentEnd": "Einsatzende",
    "incidentId": "Einsatz-ID",
    "alarmMessage": "Alarmmeldung",
    # «Fotos», not «Beilagen»: the upload takes `image/*` and nothing else, and the app says
    # Foto at every other step («Foto hinzufügen», «Bildlegende»). A heading that promises a
    # Beilage the surface cannot accept is a heading that has to be explained.
    "attachments": "Fotos",
    # …and the reference under each plate. The NUMBER is the contract — it is what a journal
    # entry, a phone call and this sheet all name the picture by, so it stays put and stays the
    # same; only the label spells itself out. «B1» was a code the reader had to be told, on a
    # sheet whose whole job is to be legible to somebody who was not there.
    "figure": "Bild {n}",
    "summary": "Kurzbericht / durchgeführte Arbeiten",
    "lehren": "Lehren / Sicherheit",
    "remarks": "Bemerkungen",
    "partnerOrgs": "Partnerorganisationen",
    "partnerOther": "Weitere",
    "kroki": "Kroki",
    "atemschutz": "Atemschutzüberwachung",
    # printed under the heading, so the contact log can be judged against the rule it ran on
    "azInterval": "Funkkontakt-Intervall: {n} min · überfällig ab +{g} min",
    "azIntervalNoGrace": "Funkkontakt-Intervall: {n} min",
    # the house term (copy · atemschutz.memberLabel); «Mitglieder» reads like a club. Numbered
    # per row so the sheet names the Trupp exactly the way the form that filled it does.
    "memberN": "AdF {n}",
    "auftrag": "Auftrag / Ziel",
    "line": "Leitung",
    "equipment": "Ausrüstung",
    "entry": "Eintritt",
    "exit": "Austritt",
    # A Sicherungstrupp that stood ready and was stood down never entered anything, so it has no
    # «Eintritt» and its stamp is not an «Austritt». Printed as its own row — the sheet is the
    # legal account, and a crew that was under PA and one that was not are different facts.
    "notDeployed": "Nicht eingesetzt",
    # the heading of a numbered Trupp, and the per-cycle rows under it (docs/trupp-naming.md §5)
    "truppHeading": "Trupp {no} – {leader}",
    # a Trupp a merge renumbered (two devices minted one number at once, docs/trupp-naming.md §7):
    # its early Verlauf rows still say the old number, so the heading names it too
    "truppHeadingFormer": "Trupp {no} (zuerst {former}) – {leader}",
    "cycle": "Einsatz {n}",
    "colTime": "Zeit",
    "colKind": "Art",
    "colPressure": "Druck bar",
    "noPressureLog": "Kein Druckverlauf erfasst.",
    "personal": "Personal / Anwesenheit",
    # the app's own word for it (copy · anwesenheit.guestBadge) — one thing, one name for it,
    # on the screen and on the paper
    "guest": "Gast",
    # On a RUNNING Einsatz there is no Einsatzende, so no block can be totalled — the sheet then
    # says the one thing it knows (how many were there) instead of «0:00 · gerundet 0:00» plus a
    # paragraph explaining why both are nothing. The rounding rule is not printed at all: it is
    # the same rule on every rapport a station prints, and it belongs in the Weisung, not on
    # every sheet next to the two numbers anybody actually transfers.
    "personalCount": "<b>{n} Anwesende</b>",
    "personalTotals": "<b>{n} Anwesende</b> · Einsatzstunden <b>{h}</b> · gerundet <b>{r}</b>",
    "journal": "Einsatzjournal",
    # «Messungen» (10.11.2026): one block per Messpunkt. The Stufe is a WORD on every row that
    # has one — the mark and the colour are extra, a monochrome print keeps the word. Over range
    # says both what the detector showed and what it counts as.
    "messungen": "Messungen",
    "messungenLimits": "Grenzwerte dieses Einsatzes: {limits}.",
    "colGas": "Gas",
    "colWert": "Wert",
    "colStufe": "Stufe · weitere Gase",
    "messungOne": "1 Messung",
    "messungMany": "{n} Messungen",
    "messungLast": "zuletzt {t}",
    "stageA1": "A1 Voralarm",
    "stageA2": "A2 Hauptalarm",
    "stageOver": "über Messbereich (A2 Hauptalarm)",
    "stageUnreadable": "unlesbar",
    #: stands in for a figure sheet the renderer threw on (plan / Skizze pages)
    "pageFailed": "Seite «{t}» konnte nicht gedruckt werden.",
    # Aufträge / Pendenzen — the column headings are word-for-word the BGV form's, so whoever
    # knows the paper finds their way on the print without being told it is the same thing.
    "pendenzen": "Aufträge / Pendenzen",
    "colWas": "Was",
    "colWer": "Wer",
    "colErteilt": "Erteilt",
    "colErledigt": "Erledigt",
    "pendenzOpen": "offen",
    # the Tafel's pages (app/report_board)
    "boardMapAt": "Karte, Stand {t}",
    "boardContinued": "Fortsetzung: {t}",
    "pendenzUrgent": "dringend",
    # the column carries a typed entry's Art (Info, Auftrag …) or an app row's Bereich (Kroki,
    # Trupps …) – the app keeps those two words apart (sweep E.5), so the head names both
    "colArea": "Art / Bereich",
    "colEntry": "Eintrag",
    "transcript": "Transkript",
    # a corrected row: latest wording above, this line says when and what it started as —
    # the printed counterpart of the app's «korrigiert HH:MM»-chip + «Der ursprüngliche
    # Wortlaut bleibt im Protokoll»
    "correctedLine": "korrigiert {t} · ursprünglich: «{text}»",
    # a row that reached the record after the Einsatzende — under its time, like the app's badge
    "nachtrag": "Nachtrag",
    # sub-line under «Was» when an Auftrag / eine Pendenz carried a timed Erinnerung
    "pendenzDue": "fällig {t}",
    "noEntries": "Keine Einträge.",
    "signoff": "Unterschriften",
    "sigOrtDatum": "Ort, Datum",
    "sigKommandant": "Kommandant",
    # the small line under a drawn signature: when it was made and what it covers.
    # ⚠️ Not «Digital unterschrieben»: that reads as a qualified e-signature (ZertES), and a drawn
    # signature on a shared station login is a simple one – the same trust as a pen (19.10.2026)
    "sigOnScreen": "Am Bildschirm unterschrieben {at} · Prüfsumme {sum}",
    "generatedAt": "Erstellt",
    "mittel": "Material",
    # «Gerettet», not «Gerettete»: the box is a form label followed by what was rescued
    # («Gerettet: 2 Personen»), not a noun standing on its own.
    "gerettete": "Gerettet",
    "alarmRef": "Einsatz-Nr",
    "rueckmeldungElz": "Rückmeldung ELZ",
    # printed IN a details-box field that was answered «Entfällt».
    # ⚠️ A DASH, not the word (22.08.). The word sat in the value column where a name belongs, so
    # on a sheet that gets signed it read like something somebody had entered. «–» is the ordinary
    # form-language for «hier ist nichts einzutragen» and stays clearly an ANSWER: a field nobody
    # filled in still prints its empty write-in rule, which is the distinction this exists for.
    # The app keeps the word on screen — there the dashed frame alone would not say why.
    "entfaellt": "–",
    "zeiten": "Alarmierungs- / Ausrückzeiten",
    "erfasser": "Erfasst durch",
}

# two underscores per side: Helvetica digits and «_» share the same 556/1000 advance,
# so a blank stub lines up column-exact with a machine-filled HH:MM next to it
_TIME_STUB = "__:__"
_LINE_STUB = " "  # write-in rows: empty cell, the ruled underline is the affordance
#: THE write-in texture for the whole sheet: a fine dotted leader. It already carried the
#: details box, Kontaktperson, Rückmeldung ELZ, Gerettet and the Kurzbericht lines; the roster
#: clocks and the Material amounts join it, so «hier schreiben» looks the same everywhere
#: instead of being underscores in one block and dashes in the next.
_WRITE_DASH = (1, (0.8, 0.8))
