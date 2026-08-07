# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Partner Fantasy League — Konventionen

Sprache: Deutsch. UI-Texte, SQL-Kommentare und Dokumentation auf Deutsch, Code-Bezeichner
auf Englisch. Commit-Nachrichten ohne Umlaute (`loest`, `zerstoerte`), ebenso SQL-Kommentare.

## Wo was steht

| | |
|---|---|
| `supabase/CURRENT.md` | **Aktueller Stand der Datenbank** — Tabellen, Funktionen, Policies, Indizes, jeweils mit der Migration, in der sie zuletzt definiert wurden. Generiert; hier zuerst nachsehen statt über alle Migrationen zu suchen. |
| `supabase/migrations/` | Die verbindliche Fassung samt Begründung. 11 Funktionen sind mehrfach neu definiert — es gilt immer die **höchste** Migrationsnummer. |
| `PROGRESS.md` | Technisches Log: was geändert wurde und **warum**, inklusive bewusst getroffener Kompromisse und offener Entscheidungen. Ganz oben der aktuelle Stand. |
| Obsidian-Vault | Konzeptpapier und Meilensteine in Kurzform (siehe unten). |

Nach einer Änderung an den Migrationen `npm run schema` laufen lassen — `CURRENT.md` wird
daraus neu erzeugt und nie von Hand bearbeitet.

## Datenbank

- **Migrationen laufen manuell im Supabase-Dashboard**, es gibt keine automatische Anwendung.
  Nach einer neuen Migration im Abschlussbericht erwähnen, dass sie noch auszuführen ist —
  und ob sich eine RPC-Signatur ändert (dann muss der App-Build dazu passen).
- Änderungen mit Regeln laufen über **SECURITY-DEFINER-RPCs**, nicht über breite Policies:
  RLS wirkt immer auf die ganze Zeile und kann keine einzelnen Spalten schützen. Muster:
  `delete_group`, `leave_group`, `rename_group`, `delete_account`, `delete_custom_category`.
- Jede SECURITY-DEFINER-Funktion braucht `set search_path = public`.
- Der Punktwert eines Eintrags wird **serverseitig** in `apply_point_entry_rules()` aus der
  Kategorie abgeleitet. Der Client sendet keinen Wert — die INSERT-Policy auf `point_entries`
  erlaubt auch direkte Inserts, der Trigger ist der einzige Chokepoint.
- Gruppen werden **weich** gelöscht (`groups.deleted_at`). Punkte und Badges bleiben, weil das
  Erfolgskonto lebenslang gilt. Gelöschte Gruppen überall ausfiltern.
- **Minuspunkte sind als Feature geplant.** Keine `points >= 0`-Constraints einführen; das
  Vorzeichen ist eine Eigenschaft der Kategorie. Offene Entscheidungen dazu stehen am Ende
  von Migration 37.

## App

- `App.tsx` ist ein Monolith mit 17 Screens (`type Screen`). Gezielt mit Grep und
  Zeilenbereichen arbeiten, nicht am Stück lesen.
- Farben nur aus `theme/colors.ts`, Icons nur aus `theme/icons.ts` — keine Hex-Werte und
  keine Emojis im Code.
- Ändern sich Spielregeln (Punkte, Kappung, Badges, Gruppen), **Hilfe-Screen und FAQ
  mitziehen**. Beide stehen in `App.tsx` im `help`-Screen.
- Abfragefehler nie verschlucken: `failed(titel, error)` melden und abbrechen.
- `npx tsc --noEmit` muss fehlerfrei durchlaufen.

## Git

Das Repo committet und pusht sich automatisch als `auto: save progress`. Vor dem Committen
`git status` prüfen — die Arbeit ist womöglich schon drin. Diese Commits nicht umschreiben.
