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

## Schritt 5 – Männerprofil + Partner-Code-System (2026-08-05)
- Partner-Code-System (Invite-Code beim Partner-Anlegen, Männer-Onboarding per Code,
  Disconnect) war bereits aus einer früheren Session vorhanden (`partner_connections`,
  `connect_to_partner` RPC) – hier erweitert statt neu gebaut
- Neue `profiles`-Tabelle mit `role` ('woman'/'man') als Datenmodell-Ergänzung; da
  `auth.users` nicht direkt erweitert werden soll, läuft das über eine Begleit-Tabelle mit
  Trigger (Partner anlegen → role='woman') bzw. RPC-Erweiterung (Code verbinden → role='man')
  plus Backfill für Bestandsdaten. Die App-Navigation nutzt weiterhin die bestehende
  Datenerkennung, nicht das role-Feld direkt
- Neue wiederverwendbare Komponente `components/BadgeGrid.tsx`: zeigt alle Badges gruppiert
  nach Typ, verdiente farbig mit ×N-Zähler bei wiederholbaren, offene ausgegraut,
  Fortschrittsbalken für Typ 1+2, versteckte Typ-5-Badges nur nach Erhalt sichtbar
  (self-contained: lädt Badges/Fortschritt selbst anhand `partnerId`-Prop)
- Männerprofil zeigt jetzt die Badge-Übersicht als Hauptinhalt (pro Verbindung, falls
  mehrere), darunter weiterhin die Liste verbundener Frauen mit Disconnect-Option
- Migration: `supabase/migrations/20260804_20_profiles_role.sql`

## Schritt 6 – Frauen-Ansicht: Partner-Badge-Übersicht (2026-08-05)
- Partnername im Header von "Meine Gruppen" ist jetzt klickbar (unterstrichen, mit ›) und
  öffnet den neuen Screen `partner-badges`
- Screen nutzt exakt dieselbe `BadgeGrid`-Komponente wie das Männerprofil (kein Duplikat) –
  ohne Disconnect-Button und ohne Invite-Code, wie gefordert
- Kein neues Datenbank-SQL für diesen Schritt nötig

## Nacharbeiten nach Rollout (2026-08-05)
- Migration 16 versehentlich in zwei Teilen ausgeführt (Schema+Delete, dann Insert) – dabei
  ist der DELETE-Schritt für die alten Kategorien nicht durchgekommen, wodurch 16 alte
  Kategorien neben den 34 neuen Tier-Kategorien liegen blieben (Summe 50 statt 34). Per
  gezieltem Cleanup (`delete ... where is_global = true and tier is null`) manuell behoben,
  keine Migration dafür nötig
- Korrektur: der neue Kategorienkatalog hat **34** Einträge (13 Haushalt, 7 Mental Load,
  8 Romantik, 6 Verlässlichkeit), nicht 33 wie ursprünglich im Chat gesagt
- BadgeGrid: nicht verdiente Badges zeigten die ganze Kachel ausgegraut statt nur das Emoji –
  gefixt, Kachel-Hintergrund und Name bleiben jetzt normal
- "Punkte vergeben": Standard-Aufgaben waren unsortiert in einer flachen Liste – jetzt nach
  Kategorie gruppiert (mit Überschrift je Kategorie) und innerhalb nach Tier sortiert
- Badges hatten innerhalb eines Typs keine feste Reihenfolge (nur `order by badge_type`,
  ohne Sekundärsortierung nicht deterministisch) – neue Spalte `badges.sort_order` mit
  fester Reihenfolge je Typ (Meilensteine nach Schwelle, Spezialisten nach
  Kategorie+Bronze/Silber/Gold, Konsistenz nach Dauer, Saisontitel Woche→Monat→Jahr)
- Migration: `supabase/migrations/20260804_21_badge_sort_order.sql`

## Feature: Gruppe löschen (2026-08-05)
- Neuer "Gruppe löschen"-Button auf der Gruppenkarte in "Meine Gruppen" – nur sichtbar für
  die Erstellerin der Gruppe (`created_by === eigene user_id`)
- RPC `delete_group(p_group_id)`: prüft serverseitig, dass nur die Erstellerin löschen darf,
  räumt danach abhängige Daten auf (partner_badges, group_category_overrides,
  point_entries, group-eigene point_categories, group_partner_memberships, group_members)
  und löscht zuletzt die Gruppe selbst
- `join_group_by_invite_code`-RPC liefert jetzt zusätzlich `created_by` zurück, damit der
  Client weiß, ob die beitretende Person Erstellerin ist
- Migration: `supabase/migrations/20260804_22_delete_group_rpc.sql`

## Feature: Partner-Profilbilder (2026-08-05)
- Neue Spalte `partners.avatar_url`, neuer öffentlicher Storage-Bucket `avatars`
  (Pfad-Schema `<partner_id>/<dateiname>`, RLS: nur Partner-Eigentümerin darf hochladen/
  ändern/löschen, Lesen ist öffentlich)
- Foto auswählen/ändern in Profil & Einstellungen (Bildauswahl mit quadratischem Zuschnitt,
  Upload als Base64 → ArrayBuffer via `base64-arraybuffer`)
- Neue wiederverwendbare Komponente `components/Avatar.tsx`: zeigt das Bild kreisrund an,
  ohne Bild ein Kreis mit Anfangsbuchstabe auf deterministischer Hintergrundfarbe
  (gleicher Name → immer gleiche Farbe)
- Avatar prominent neben dem Namen auf der Badge-Seite (Männerprofil & Frauen-Ansicht
  "Partner-Badges")
- Gruppenkarten in "Meine Gruppen" zeigen jetzt die (sich überlappenden) Avatare aller
  aktiven Partner der Gruppe
- Neue Pakete: `expo-image-picker`, `base64-arraybuffer`
- Migration: `supabase/migrations/20260804_23_partner_avatars.sql`
