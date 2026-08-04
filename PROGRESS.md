# Partner Fantasy League – Fortschritt (Update: Tier-System & Gamification)

Fortsetzung des Umbaus laut Balancing-&-Gamification-Konzept. Ausführliches Fortschritts-Log
inkl. Vorgeschichte liegt im Obsidian-Vault ("Fantasy Partner League.md"). Diese Datei trackt
speziell die 6-Schritte-Umbau-Sequenz.

## Schritt 1 – Tier-basiertes Punktesystem (2026-08-05)
- Alte 16 Standard-Kategorien gelöscht, ersetzt durch 33 Kategorien in 4 Gruppen: Haushalt,
  Mental Load (neu), Romantik & Aufmerksamkeit, Verlässlichkeit & Partnerschaft
- Nur noch 5 erlaubte Punktewerte (Tier 1–5: 2/5/10/20/40)
- `point_categories`: neue Spalten `tier`, `multiplier_eligible`
- `point_entries`: neue Spalte `without_request`
- Toggle "Ohne Aufforderung" (×1,5, aufgerundet) in der Punktvergabe-UI – nur für Haushalt
  und Mental Load verfügbar
- Eigene Kategorien: Tier-Auswahl (2/5/10/20/40) statt freiem Zahlenfeld, Maximum Tier 5
- Migration: `supabase/migrations/20260804_16_tier_point_system.sql` (manuell im Supabase
  Dashboard auszuführen)

## Schritt 2 – Anti-Farming-Regeln (2026-08-05)
- Serverseitig per Postgres-Trigger (`before insert on point_entries`) – kann nicht durch
  den Client umgangen werden, da er unabhängig vom übermittelten `points`-Wert greift
- Abnehmender Ertrag: 1. Eintrag derselben Aufgabe/Tag = 100%, 2. = 50% (aufgerundet),
  3. und weitere = 0 Punkte (wird weiter geloggt)
- Tageslimit: 80 Punkte pro Partner und Tag (über alle Gruppen), danach zählen weitere
  Einträge 0 Punkte; UI zeigt freundlichen Hinweis "Er hatte heute wohl einen sehr guten
  Tag 😉"
- Neue Spalte `point_entries.capped_reason` ('daily_limit' | 'task_repeat' | null) für die
  richtige Client-Meldung
- Activity Log zeigt 0-Punkte-Einträge mit Hinweis "0 Punkte – Tageslimit erreicht"
- Obergrenze eigene Kategorien: bereits durch Tier-System aus Schritt 1 serverseitig
  abgesichert (Tier max. 5 = 40 Punkte, `point_categories_custom_tier_required`-Constraint)
- Migration: `supabase/migrations/20260804_17_anti_farming_rules.sql`

## Schritt 3 – Saisonstruktur (2026-08-05)
- Woche/Monat/Jahr-Tabs waren bereits kalenderbasiert (Woche = Mo–So, Monat = Kalendermonat,
  Jahr = Kalenderjahr) – der Punkte-"Reset" zum 1. Januar passiert dadurch automatisch beim
  Filtern, alte Einträge bleiben für die Historie erhalten
- Ranking zeigt jetzt beim Erstplatzierten den kontextuellen Titel ("Spieler der Woche" /
  "Monatssieger" / "Saisonsieger [Jahr]") je nach gewähltem Tab
- Neue Typ-4-Badges (Saisontitel, wiederholbar): Spieler der Woche, Monatssieger, Saisonsieger
- `badges`-Tabelle um `badge_type`, `is_hidden`, `is_repeatable` erweitert; `partner_badges`
  um `period_key` erweitert (Basis für Schritt 4, wird dort für die übrigen Badge-Typen
  weiterverwendet)
- Funktion `award_period_title(period)` ermittelt pro Gruppe automatisch die/den
  Erstplatzierte(n) des zuletzt abgeschlossenen Zeitraums und vergibt den Titel
- **Wichtig:** automatische Vergabe läuft über `pg_cron` (wöchentlich Mo 00:05 UTC, monatlich
  1. um 00:05 UTC, jährlich 1.1. um 00:05 UTC) – falls die Extension im Supabase-Projekt noch
  nicht aktiviert ist, muss sie vorher unter Database → Extensions → pg_cron aktiviert werden
- Migration: `supabase/migrations/20260804_18_season_structure.sql`

## Schritt 4 – Komplettes Badge-System, 5 Typen (2026-08-05)
- Alte 6 unstrukturierten Badges aus Migration 09 entfernt, ersetzt durch 30 Badges:
  5 Meilensteine (Typ 1), 12 Kategorie-Spezialisten (Typ 2, 4 Kategorien × Bronze/Silber/Gold),
  4 Konsistenz-Badges (Typ 3), 3 Saisontitel (Typ 4, bereits in Schritt 3), 6 versteckte
  Charakter-Badges (Typ 5)
- Scope-Entscheidung: Typ 1/2/3/5 werden partnerweit über alle Gruppen berechnet (globale
  Erfolge), nur Typ 4 bleibt pro Gruppe – dokumentiert als Kommentar in Migration 19
- `checkAndAwardBadges` komplett neu geschrieben: generische Auswertung aller trigger_types
  (total_points, category_points, streak_weeks, comeback, hellseher, allrounder,
  dishwasher_count, anniversary, tier4_month, custom_category_count)
- Wiederholbare Badges (Typ 3) werden pro Wochen-`period_key` einzeln vergeben, damit ein
  gebrochener und neu aufgebauter Streak erneut zählt
- Migration: `supabase/migrations/20260804_19_full_badge_system.sql`
