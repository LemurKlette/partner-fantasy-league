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

## Nachtrag: Avatar-Kompression (2026-08-05)
- Bild wird vor dem Upload mit `expo-image-manipulator` auf 300×300px verkleinert und als
  JPEG mit Qualität 0.7 komprimiert (statt nur Picker-Kompression ohne Größenbegrenzung)
- Reduziert Dateigröße von potenziell mehreren MB (modernes Handyfoto) auf grob 20–50 KB pro
  Avatar — schont Supabase-Storage- und vor allem Egress-Kontingent im Free-Tier
- Neues Paket: `expo-image-manipulator`

---

# Design-System-Integration (6 Schritte)

## Schritt 1 – theme/colors.ts (2026-08-06)
- `theme/colors.ts` als einzige Farbquelle der App angelegt: `COLORS` (Flächen, Aktionen,
  Text, Ranking, gesperrte Badges) und `CATEGORY_COLORS` (4 Kategorien je stroke/fill)
- Haushalt bewusst Ocker (`#854F0B`), **nicht** Terrakotta — Terrakotta bleibt
  ausschließlich Aktionsfarbe, damit dieselbe Farbe nicht gleichzeitig "hier kannst du
  tippen" und "das ist Haushalt" bedeutet
- Zusätzlich `CATEGORY_TAG_TO_KEY` als Brücke zwischen den `category_tag`-Werten aus der
  Datenbank (`haushalt`, `mental_load`, …) und den Theme-Schlüsseln
- Regel ab jetzt: außerhalb von `theme/colors.ts` steht nirgendwo ein Hex-Wert

## Schritt 2 – theme/icons.ts (2026-08-06)
- `theme/icons.ts` mit 80 semantischen Icon-Schlüsseln angelegt (Kategorien, Aufgaben,
  Navigation/UI, Badges aller 5 Typen), ausschließlich MaterialCommunityIcons
- Alle 80 Namen automatisiert gegen den echten Glyphmap-Bestand (7448 Icons) in
  `@expo/vector-icons` validiert
- **2 Abweichungen nötig** (Wunschname existiert nicht, Ersatz aus derselben Familie):
  - `badgeHousehold3`: `home-star` → **`home-variant-outline`** (die Stufe wird ohnehin über
    die Rahmenform ausgedrückt, nicht über das Icon)
  - `badgeRomance1`: `message-heart-outline` → **`email-heart-outline`** (nächster Treffer
    mit Nachricht+Herz)
- Zusätzlich: `ICON_SIZE` (inline 20 / list 24 / category 28 / badge 32) und Helfer
  `iconFor(key)`, der einen in der DB gespeicherten `icon_key` auflöst

## Schritt 3 – BadgeFrame-Komponente (2026-08-06)
- `components/BadgeFrame.tsx`: Stufe wird über die **Rahmenform** ausgedrückt, nicht über
  Farbe — 5 Zacken = Stufe 1, 7 Zacken = Stufe 2, 9 Zacken = Stufe 3, Kreis = keine Stufe
- Als echtes SVG via `react-native-svg` gerendert (nicht als PNG), damit Farben und
  Ausgrauung jederzeit änderbar bleiben
- Polygone als Modul-Konstanten hinterlegt, werden nicht bei jedem Render neu berechnet
- Gesperrte Badges: eigene Füll-/Strich-/Icon-Farbe (`disabled`/`inkMuted`/`disabledInk`)
  **plus** Opazität 0.4 — Ausgrauung läuft bewusst nie allein über Opazität, die wirkt auf
  verschiedenen Untergründen unterschiedlich
- Exportiert zusätzlich `frameColors()`, damit die Badge-Komponente in Schritt 4 dieselbe
  Farblogik für das Icon nutzt statt sie zu duplizieren
- Neues Paket: `react-native-svg`

## Schritt 4 – Badge-Komponente (2026-08-06)
- `components/Badge.tsx` als **einzige** Badge-Darstellung der App — kein Badge wird
  irgendwo von Hand nachgebaut, damit Größe, Rahmenform und Ausgrauung überall gleich sind
- Nutzt `BadgeFrame` als Rahmen und rendert darin entweder das Icon aus `theme/icons.ts`
  **oder** ein Bild, falls `image_url` gefüllt ist (beides in derselben Komponente, damit
  Größe/Kreisform/Ausgrauung identisch bleiben)
- Zähler-Punkt unten rechts bei mehrfach erhaltenen Badges (Terrakotta-Hintergrund,
  `onTerracotta`-Text, 2px Rand in der Hintergrundfarbe des Screens via
  `surroundingColor`-Prop)
- Badge-Name darunter, optionaler Fortschrittsbalken (`gold` auf `sandDeep`) für
  Stufen-Badges
- Versteckte Badges (`isHidden`) werden vor dem Verdienen gar nicht gerendert — auch nicht
  ausgegraut

## Schritt 5 – Datenbank auf Icon-Schlüssel umgestellt (2026-08-06)
- `badges`: neue Spalten `image_url` (nullable, für spätere Illustrationen statt Icon),
  `tier` (smallint, nur bei Spezialisten-Badges 1–3 gesetzt, mit CHECK-Constraint),
  `icon_key` (semantischer Schlüssel aus `theme/icons.ts`, nicht der Icon-Name selbst)
- Alle 30 Badges auf `icon_key` + `tier` aktualisiert
- `point_categories`: neue Spalte `icon_key`; alle 34 Standard-Aufgaben auf ihren
  spezifischen Task-Schlüssel gemappt (z.B. "Bad geputzt" → `taskBathroom`)
- Selbst angelegte Gruppenkategorien bekommen den Sammel-Schlüssel ihrer Kategorie bzw.
  `actionAddPoints`, damit nirgendwo mehr ein Emoji gerendert wird
- Migration: `supabase/migrations/20260804_24_design_system_icons.sql`

## Schritt 6 – Alle Screens auf COLORS und ICONS umgestellt (2026-08-06)
- **Null Hex-Werte** außerhalb von `theme/colors.ts` und **null Emojis** in der UI — beides
  automatisiert im gesamten Projekt verifiziert
- Zentrales StyleSheet in `App.tsx` komplett auf Tokens: Screens `sand`, Karten `surface`,
  Header/Footer/Tabs `sandDeep`, Primärbuttons `terracotta` mit `onTerracotta`-Text
- Ranking: Platz 1 mit Pokal-Icon in `gold`, Plätze 2+ in `inkMuted`
- Aktivitätslog: Kategorie-Icon im farbigen Kreis der jeweiligen Kategorie (neue
  `CategoryIcon`-Hilfskomponente, nutzt `catColors()` + `icon_key` aus der DB)
- Aufgabenlisten: Kategorie-Überschriften mit Icon in der Kategoriefarbe, jede Aufgabe mit
  ihrem eigenen Icon im Kreis
- Eigene Kategorie anlegen: Emoji-Freitextfeld durch eine Auswahl von 12 Icons ersetzt
  (`CUSTOM_CATEGORY_ICON_CHOICES`), gespeichert wird der Schlüssel
- `Avatar.tsx`: bunte Zufallspalette entfernt, nutzt jetzt `terracottaLight` als
  Avatar-Hintergrund gemäß Design-System
- `BadgeGrid.tsx`: baut Kacheln nicht mehr selbst, sondern rendert ausschließlich die
  `Badge`-Komponente
- Umgestellte Screens: Login/Registrierung, Onboarding-Auswahl, Partner anlegen,
  Partner-Code, Gruppe erstellen/beitreten, Meine Gruppen, Gruppen-Detail, Punkte vergeben,
  Kategorien verwalten, Eigene Kategorie, Hilfe (3 Tabs), Code eingeben, Männerprofil,
  Partner-Badges, Profil & Einstellungen
- Nebenbei behoben: die zwei seit Längerem bestehenden TypeScript-Fehler (Supabase
  typisiert 1:1-Relationen als Array) — `npx tsc --noEmit` läuft jetzt **komplett
  fehlerfrei**, und `expo export` bündelt sauber durch
- Neue Pakete: `react-native-svg` (Schritt 3), `@expo/vector-icons` war bereits über Expo
  vorhanden

---

# Sicherheits-Audit: behobene Punkte (2026-08-06)

Nach einem vollständigen Scan von Secrets, allen 24 Migrationen (RLS, RPCs, Trigger) und der
App-Logik wurden folgende Punkte behoben. Migration: `20260804_25_security_fixes.sql`.

## 1 – Männerprofil zeigte keine Badges (kritisch)
- Ursache: `partner_badges` und `point_entries` waren nur über `get_my_group_ids()` lesbar.
  Männer stehen aber nie in `group_members`, sondern hängen über `partner_connections` dran —
  beide Queries in `BadgeGrid` lieferten leer, alle Badges erschienen gesperrt mit 0 Fortschritt
- `partner_badges` SELECT um eigene und verbundene Partner erweitert
- `point_entries` wurde **bewusst nicht** geöffnet: die Tabelle enthält die Notizen der Frauen,
  die privat bleiben. Stattdessen neue Funktion `partner_point_totals(partner_id)`
  (SECURITY DEFINER, mit eigener Zugriffsprüfung), die nur die Summen je Kategorie liefert
- `BadgeGrid` nutzt jetzt diese RPC statt `point_entries` direkt

## 2 – „Konto löschen" schlug immer fehl (kritisch)
- `delete_account()` berücksichtigte nur **einen** Partner (seit dem Mehrfach-Partner-Feature
  falsch) und lief dann in eine Fremdschlüsselverletzung, weil `partner_connections`,
  `partner_badges` und `point_entries` auf `partners` ohne `on delete cascade` verweisen
- Komplett neu geschrieben nach dem Muster von `delete_partner`: löst zuerst selbst erstellte
  Gruppen auf, dann alle eigenen Partner samt abhängiger Daten, dann Einträge in fremden
  Gruppen, löst die Urheberschaft an Gruppenkategorien (die anderen Mitgliedern erhalten
  bleiben) und trennt Verbindungen, in denen die Person der Mann war

## 3 – Punkte und Badges für fremde Partner buchbar (hoch)
- Die INSERT-Policies auf `point_entries` und `partner_badges` prüften nur Gruppen­mitgliedschaft,
  nicht ob `partner_id` überhaupt der eigene Partner ist — ein Gruppenmitglied konnte per
  direktem API-Aufruf für den Partner einer anderen Nutzerin buchen
- Beide Policies um `partner_id = any(get_my_partner_ids())` erweitert. `award_period_title()`
  ist SECURITY DEFINER und vergibt die Saisontitel weiterhin korrekt

## 4 – Punktwert-Overrides umgingen das Tier-System (hoch)
- `group_category_overrides` hatte keinerlei Wertprüfung, der Screen „Kategorien verwalten"
  ein freies Zahlenfeld — eine Gruppe konnte jede Aufgabe auf beliebige Werte setzen
- CHECK-Constraint auf `points in (2,5,10,20,40)`, Alt-Werte außerhalb des Systems werden
  entfernt (betroffene Kategorien fallen auf ihren Standardwert zurück)
- UI: Zahlenfeld durch dieselbe Tier-Auswahl ersetzt wie beim Anlegen eigener Kategorien
- `handleSaveOverrides` schreibt jetzt nur noch abweichende Werte und **löscht** Overrides,
  die wieder auf dem Standard stehen (dafür neue DELETE-Policy — bisher ließ sich ein einmal
  gesetzter Override nicht mehr entfernen)

## 5 – `join_group_by_invite_code` ohne festen `search_path` (hoch)
- Als einzige der 13 SECURITY-DEFINER-Funktionen fehlte ihr `set search_path = public`
  (klassischer Postgres-Rechteausweitungs-Vektor, wird auch vom Supabase-Linter gemeldet)

## 6 – Tageslimit ließ sich um bis zu 39 Punkte überschreiten (mittel)
- Der Trigger prüfte nur, *ob* die 80 Punkte erreicht sind — der Eintrag, der die Grenze
  überschreitet, zählte voll (bei 75 Punkten gab eine Tier-5-Aufgabe noch volle 40 → 115)
- Jetzt wird erst die Halbierung bei Wiederholung angewendet und danach auf den Restbetrag
  bis 80 gekappt. Die App meldet den Teilbetrag zurück („davon zählen noch X Punkte")

## 7 – Tagesgrenze lief in UTC statt in der Zeitzone des Geräts (mittel)
- Der „neue Tag" begann im Sommer um 02:00 Uhr deutscher Zeit
- Neue Spalte `profiles.timezone`; die App meldet beim Login die Zeitzone des Mobilgeräts
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`) über die RPC `set_my_timezone`, die
  den Wert gegen `pg_timezone_names` validiert
- Der Anti-Farming-Trigger zieht die Tagesgrenze jetzt in dieser Zeitzone, Fallback
  `Europe/Berlin`. Die Woche/Monat/Jahr-Filter der App rechneten bereits in Gerätezeit
- `award_period_title()` richtet sich als gruppenübergreifender Cronjob an
  `Europe/Berlin` aus statt an UTC; zusätzlich `revoke execute ... from public`, da die
  Funktion nur für den Cronjob gedacht ist

## 8 – Kategorien waren weltweit lesbar (mittel)
- Die SELECT-Policy war `using (true)` ohne Rollenbeschränkung. Da der Publishable Key im
  App-Bundle steckt, konnte auch eine unangemeldete Person sämtliche selbst erstellten
  Kategorienamen aller Gruppen auslesen
- Jetzt `to authenticated` und nur noch globale Kategorien plus die der eigenen Gruppen

## 9 – Eine Gruppe ließ sich nicht verlassen (mittel)
- `group_members` hatte keine DELETE-Policy — wer beigetreten war, kam nur wieder raus,
  wenn die Erstellerin die ganze Gruppe löschte
- Neue RPC `leave_group(group_id)`: nimmt die eigenen Partner aus der Gruppenwertung
  (Punkte bleiben als Historie) und entfernt die Mitgliedschaft. Erstellerinnen werden
  bewusst abgewiesen — für sie gibt es „Gruppe löschen"
- Auf der Gruppenkarte erscheint je nach Rolle „Gruppe löschen" oder „Gruppe verlassen"

## 10 – Alte Avatare blieben für immer im Bucket (mittel)
- Bei jedem Fotowechsel wurde eine neue Datei geschrieben und nur die URL aktualisiert
- Nach erfolgreichem Update werden jetzt die übrigen Dateien im Partner-Ordner entfernt —
  bewusst *nach* dem Update, damit nie die gerade referenzierte Datei gelöscht wird

---

# Weitere Anpassungen (2026-08-06)

## Standard-Punktwerte sind jetzt unveränderlich
- Die Möglichkeit, Punktwerte der voreingestellten Aufgaben pro Gruppe zu überschreiben,
  wurde komplett entfernt — inklusive der zugehörigen Bedienelemente
- `loadCategories` liest keine Overrides mehr, `handleSaveOverrides` und der
  „Änderungen speichern"-Button sind entfallen
- Der Screen heißt jetzt „Eigene Kategorien" und dient nur noch dazu, selbst erstellte
  Kategorien einzusehen und zu löschen; der Link im Gruppen-Detail wurde entsprechend
  umbenannt
- Die Tabelle `group_category_overrides` bleibt vorerst bestehen, wird aber von der App
  nicht mehr gelesen oder geschrieben

## Startseite: Partner statt „Meine Gruppen" im Header
- Im Kopf der Übersicht steht jetzt prominent der Partnername mit seinem Bild (52 px), die
  ganze Zeile führt zur Badge-Seite
- „Meine Gruppen" ist zur Abschnittsüberschrift über der Gruppenliste geworden
- Solange noch kein Partner angelegt ist, steht wie bisher „Meine Gruppen" im Header

## Partnerbild wird überall sofort aktualisiert
- Bisher wurde nach dem Hochladen nur die Profilliste und der Header-Partner aktualisiert;
  Gruppenkarten, Mitgliederliste, Partner-Auswahl beim Punktevergeben und die Badge-Seite
  zeigten das alte Bild bis zum nächsten Login
- Neue Hilfsfunktion `applyAvatarLocally()` schreibt die neue URL in alle betroffenen
  Zustände (`myPartners`, `myAllPartners`, `partner`, `viewedPartner`, `groupMembers`,
  `groupAvatarsMap`)

## Nebenbei
- Rückmeldung beim Punktevergeben unterscheidet jetzt die drei Fälle: gekappt durch
  Tageslimit, dritter Eintrag derselben Aufgabe, oder halbierte Punkte beim zweiten Eintrag
- Das Aktivitätslog zeigt bei 0-Punkte-Einträgen den konkreten Grund
  (`capped_reason`) statt pauschal „Tageslimit erreicht"
- Hilfe-Seite und FAQ an die neuen Regeln angepasst (feste Punktwerte, Kappung,
  Zeitzone, Gruppe verlassen)

## Fix: Eigene Kategorie löschen schlug fehl, sobald Punkte vergeben waren (2026-08-06)
- `point_entries.category_id` verweist ohne `on delete` auf `point_categories` — das Löschen
  einer bereits genutzten eigenen Kategorie endete in einer Fremdschlüsselverletzung, obwohl
  der Dialog „Vergangene Einträge bleiben erhalten" verspricht
- Neue Spalte `point_categories.archived_at` und RPC `delete_custom_category(id)`:
  nie genutzte Kategorien werden weiterhin hart gelöscht, bereits genutzte werden archiviert
- Archivierte Kategorien verschwinden aus allen Auswahllisten (`archived_at is null`-Filter
  in `loadCategories` und `loadManageCategories`), bleiben im Aktivitätslog aber mit Name
  und Icon sichtbar — das Versprechen des Dialogs stimmt damit jetzt
- Die RPC prüft serverseitig Gruppenzugehörigkeit und lehnt Standard-Aufgaben ab
- Migration: `supabase/migrations/20260804_27_archive_custom_categories.sql`

## Fix: leere Kategorieauswahl nach Migration 27 (2026-08-06)
- Symptom: „Punkte vergeben" und „Eigene Kategorie" führten auf eine komplett leere Seite
- Ursache: Der Code filtert seit Migration 27 auf `archived_at`. Solange die Spalte in der
  Datenbank fehlte, lieferte PostgREST einen Fehler statt Daten — und `loadCategories`
  ignorierte den Fehler stillschweigend, sodass eine leere Liste gerendert wurde
- Eigentlicher Defekt war also nicht der Filter, sondern die fehlende Fehlerbehandlung:
  `loadCategories` und `loadManageCategories` melden Abfragefehler jetzt per Alert, und
  „Punkte vergeben" leitet gar nicht erst weiter, wenn das Laden fehlschlägt
- Zusätzlich: Nach dem Anlegen einer eigenen Kategorie geht es zurück ins Gruppen-Detail
  (mit Bestätigung) statt in die Kategorieauswahl; der Zurück-Button dort ebenso
- **Offen:** rund 15 weitere Loader (`openGroup`, `loadRankingForGroup`, `loadGroups`,
  `loadProfileData` …) verschlucken Abfragefehler auf dieselbe Weise und würden bei einem
  Problem ebenfalls nur leere Listen zeigen

## Fehlerbehandlung flächendeckend nachgezogen (2026-08-06)
- Neuer zentraler Helfer `failed(titel, error)` in `App.tsx`: meldet den Fehler und gibt
  `true` zurück, damit der Aufrufer abbrechen kann. Enthält eine 1,5-Sekunden-Sperre, damit
  bei parallelen Abfragen (z.B. Ranking + Log + Badges im Offline-Fall) nicht mehrere
  Dialoge übereinander stapeln
- Umgestellt: `loadUserData`, `loadManProfile`, `loadGroups`, `loadGroupAvatarPreviews`,
  `loadRankingForGroup`, `loadEarnedBadges`, `loadActivityLog`, `checkAndAwardBadges`,
  `openGroup`, `loadProfileData`, `handleCreateGroup`
- `BadgeGrid` zeigt statt eines Dialogs eine Inline-Fehlerbox — die Komponente wird im
  Männerprofil mehrfach gerendert, dort wären Dialoge aufdringlich. Vorher hätte ein Fehler
  dort ausgesehen wie „alle Badges noch nicht verdient"
- Bewusst ohne Meldung bleiben nur drei Stellen, jeweils im Code begründet: das Aufräumen
  alter Avatare (Foto ist bereits gesetzt, nicht behebbar), die Zeitzonen-Meldung (Server
  fällt auf `Europe/Berlin` zurück) und die beiden `signOut`-Aufrufe

### Dabei mitgefundene Fehler
- `openGroup` lud `avatar_url` gar nicht mit — in der Mitgliederliste und der Partner-Auswahl
  beim Punktevergeben erschienen deshalb **immer** nur Initialen statt des Fotos
- `handleCreateGroup` ignorierte den Fehler beim Eintragen der Erstellerin als Mitglied: die
  Gruppe wäre angelegt worden, die Erstellerin aber kein Mitglied und hätte sie nach dem
  nächsten Login nicht mehr gesehen
- `loadRankingForGroup` und `openGroup` führten mehrere unabhängige Abfragen nacheinander
  aus; jetzt laufen sie parallel, und die Schleife für neue Gruppen-Mitgliedschaften ist ein
  Bulk-Insert statt N Einzelaufrufe

---

# Badge-Seite und Punktevergabe: 5 Verbesserungen (2026-08-06)

## Schritt 1 – Spezialisten-Badges nach Kategorie gruppiert
- Die Kategorie-Spezialisten (Typ 2) standen bisher in einem flachen Raster, in dem sich die
  vier Kategorien optisch vermischten
- Jetzt eine Überschrift je Kategorie in der jeweiligen Kategoriefarbe (Ocker, Olivgrün,
  Beere, Petrol), darunter genau 3 Badges pro Zeile
- Meilensteine, Konsistenz und Saisontitel bleiben in einem einfachen Raster (sie haben
  keine Kategorie), geheime Badges bilden den Abschluss ganz unten
- Einheitliche Kachelbreite von 31 % für alle Raster, damit die Spalten überall fluchten
- `Badge` bekam dafür zwei neue Props: `width` (Rasterbreite) und `onPress` (Vorbereitung
  für das Info-Modal in Schritt 2)

## Schritt 2 – Info-Modal beim Antippen eines Badges
- Jedes Badge ist jetzt antippbar und öffnet ein Modal mit Rahmen, Name, Erklärung und
  einem „Zurück"-Button; Antippen neben der Karte schließt ebenfalls
- Zusätzlich im Modal: Anzahl bei mehrfach erhaltenen Badges und der aktuelle Fortschritt
  bei noch offenen Badges
- Die Spalte `badges.description` existierte bereits seit Migration 09, enthielt aber eher
  Etiketten („Bronze · 200 Punkte in Haushalt"). Migration 28 schreibt alle 30 Texte als
  Anleitung um („Sammle 200 Punkte in der Kategorie Haushalt.")
- Geheime Badges zeigen ihre Erklärung damit erst, wenn sie verdient wurden — vorher werden
  sie ohnehin gar nicht gerendert
- `COLORS.scrim` für die Abdunklung hinter dem Modal ergänzt, damit auch dafür kein
  Farbwert außerhalb des Themes steht
- Migration: `supabase/migrations/20260804_28_badge_descriptions.sql`

## Schritt 3 – Eigene Kategorien in eigener Farbe
- Selbst erstellte Kategorien wurden bisher im Haushalt-Ocker dargestellt und sahen dadurch
  aus wie Standard-Aufgaben
- Neue Farbe `CATEGORY_COLORS.custom` (Taupe, stroke `#8B7355` / fill `#F5E6D3`)
- `catColors()` fällt jetzt auf `custom` statt auf `household` zurück — da eigene Kategorien
  als einzige keinen `category_tag` haben, greift das automatisch überall: Punkte vergeben,
  Aktivitätslog und Kategorien-Verwaltung
- Die Überschrift „Eigene Kategorien" beim Punktevergeben trägt Icon und Farbe ebenfalls
- Unverändert bleibt die Rückfallfarbe in `BadgeFrame`: Badges ohne Kategorie (Meilensteine,
  Konsistenz, Saisontitel) behalten wie im Design-Konzept festgelegt den Ocker-Kreis
- Ebenfalls unverändert: die Icon-Auswahl beim Anlegen nutzt weiter Terrakotta, das ist dort
  ein Auswahlzustand und keine Kategorie-Kennzeichnung

## Schritt 4 – „Ohne Aufforderung" sichtbarer gemacht
- Der Toggle existierte bereits samt ×1,5-Logik und der Spalte
  `point_entries.without_request` — er wird nur angezeigt, wenn die gewählte Aufgabe zu
  Haushalt oder Mental Load gehört (`multiplier_eligible`), wie im Konzept festgelegt
- Der Blitz im Toggle leuchtet jetzt in `COLORS.gold` statt Terrakotta, damit der Bonus
  optisch heraussticht
- Neu: Einträge mit Bonus tragen im Aktivitätslog ein kleines Blitz-Icon und den Hinweis
  „ohne Aufforderung" in Gold
- Die Spalte heißt weiterhin `without_request` (nicht `is_unprompted`): sie wird bereits von
  der Badge-Logik für „Der Hellseher" ausgewertet, eine Umbenennung hätte nur Risiko ohne
  Gewinn gebracht

## Schritt 5 – Badge-Rahmen vergrößert, Icons stören die Zacken nicht mehr
- Standardgröße eines Badges von 46 auf 62 px erhöht
- Neue Funktion `iconSizeFor(tier, size)` in `BadgeFrame.tsx`: Sterne bekommen ein
  kleineres Verhältnis (0,38) als Kreise (0,46). Grund: die Zacken zählen zur Bounding-Box,
  tragen aber nichts zur nutzbaren Fläche in der Mitte bei — ein einheitliches Verhältnis
  ließ die Icons deshalb immer in die Zacken ragen
- Ergebnis: das Icon in Sternen bleibt bei exakt 24 px wie vorher, der Rahmen drumherum
  wächst um ein Drittel. Genau das gewünschte „mehr Luft ums Icon"
- Die Logik sitzt bewusst in `BadgeFrame`, weil sie von der Rahmenform abhängt — so bleibt
  sie auch gültig, wenn später weitere Formen dazukommen

---

# Eigene Kategorien in Grau + Ranking nur mit Punkten (2026-08-07)

## Schritt 1 – Farbe für eigene Kategorien auf Grau geändert
- `CATEGORY_COLORS.custom` von Taupe (`#8B7355`/`#F5E6D3`) auf Grau
  (`#6B6B6B`/`#F0F0F0`) umgestellt
- Die Verkabelung bestand bereits: `catColors()` ist der einzige Punkt, an dem eine
  Kategoriefarbe ermittelt wird, und fällt auf `custom` zurück. Damit greift die Farbe
  automatisch beim Punktevergeben, im Aktivitätslog und in der Kategorien-Verwaltung —
  ohne Sonderbehandlung an den einzelnen Stellen
- `BadgeFrame` akzeptiert `'custom'` ebenfalls automatisch, da `CategoryKey` aus
  `CATEGORY_COLORS` abgeleitet wird
- **Dabei behobene Inkonsistenz:** `catColors()` wurde auch für die Badge-Icons in der
  Ranking-Zeile verwendet. Badges ohne Kategorie hätten damit Grau bekommen, während
  `BadgeFrame` sie laut Design-Konzept ockerfarben zeichnet. Neue Funktion `badgeColors()`
  mit Ocker-Rückfall trennt die beiden Fälle sauber

## Schritt 2 – Partner erscheinen im Ranking erst mit Punkten
Hinweis zur Benennung: Die im Auftrag genannten Tabellen `partner_group_links` und
`group_custom_categories` existieren nicht. Die reale Entsprechung ist
`group_partner_memberships`; eigene Kategorien sind Zeilen in `point_categories` mit
`is_global = false`.

- **(a) Auto-Anlage entfernt:** `openGroup` legte beim Öffnen einer Gruppe für alle Partner
  der Nutzerin eine Zugehörigkeit an — eine frisch erstellte Gruppe zeigte deshalb sofort
  alle Partner mit 0 Punkten. Diese Stelle ist raus. Migration 29 räumt zusätzlich die
  Altbestände auf, die der Backfill aus Migration 15 angelegt hatte
- **(b/c) Atomar über RPCs:** `add_point_entry()` legt die Zugehörigkeit bei Bedarf mit an,
  `delete_point_entry()` entfernt sie, wenn die Punktsumme in der Gruppe auf 0 fällt. Beide
  laufen bewusst als SECURITY INVOKER, damit die bestehenden RLS-Policies weiter greifen und
  die Berechtigungsprüfung nicht dupliziert werden muss
- **(d) Ranking** wird jetzt von der Zugehörigkeit getrieben statt von der Gruppenmitgliedschaft
  der Nutzerin, und zeigt zusätzlich den Avatar
- **(e) Mitgliederliste** und die Avatare auf den Gruppenkarten folgen derselben Quelle
- **(f) Die Partner-Auswahl beim Punktevergeben zeigt weiterhin alle eigenen Partner** —
  sonst käme nie einer erstmals in eine Gruppe
- **RLS:** `group_partner_memberships` hatte nur select/insert/update. Für (c) war eine
  DELETE-Policy nötig, sie erlaubt das Entfernen nur für eigene Partner
- Migration: `supabase/migrations/20260804_29_membership_follows_points.sql`

### Offene Frage: der manuelle Aktiv-Schalter
Der Schalter „Aktivieren/Deaktivieren" unter „Meine Partner in dieser Gruppe" stammt aus dem
alten Modell und regelt nun dasselbe Ergebnis wie die automatische Zugehörigkeit — ein
Partner kann also auf zwei Wegen aus dem Ranking verschwinden. Ich habe ihn bewusst nicht
entfernt (er funktioniert weiter als manuelles Ausblenden), die Liste zeigt jetzt aber nur
noch Partner, die tatsächlich in der Gruppe sind. Ob der Schalter bleiben soll, ist eine
Produktentscheidung.

## Bugfix: Anti-Farming-Regeln galten gruppenübergreifend (2026-08-07)
- **Fehler:** Beide Regeln in `apply_point_entry_rules()` filterten nur auf `partner_id`,
  nicht auf `group_id`. Hatte ein Partner in Gruppe A am selben Tag schon 62 Punkte, blieben
  in Gruppe B nur noch 18 übrig. Dieselbe Aufgabe zählte in Gruppe B außerdem nur halb, wenn
  sie vorher schon in Gruppe A eingetragen war
- **Betroffen waren beide Regeln**, nicht nur das Tageslimit — die abnehmende Wertung hatte
  denselben Fehler
- **Fix:** `and group_id = NEW.group_id` in beiden WHERE-Klauseln. Gruppen sind unabhängige
  Ranglisten mit unterschiedlichen Freundeskreisen; Verbrauch in der einen darf die
  Vergleichbarkeit in der anderen nicht beeinflussen
- **Zeitzone war bereits korrekt:** Die Tagesgrenze läuft über `profiles.timezone` der
  eintragenden Nutzerin (Rückfall `Europe/Berlin`), nicht über UTC — unverändert
- Hilfe-Seite und FAQ nachgezogen, sie beschrieben noch das gruppenübergreifende Verhalten
- Migration: `supabase/migrations/20260804_30_anti_farming_per_group.sql`

### Gemeldet, nicht geändert: Badge-Punkte werden global summiert
`partner_point_totals()` (Fortschrittsbalken) und `checkAndAwardBadges()` (Vergabe) filtern
beide nur auf `partner_id`, ohne `group_id` — Meilensteine und Kategorie-Spezialisten zählen
also über alle Gruppen zusammen. Mit dem jetzt gruppenweisen Tageslimit kann ein Partner in
drei Gruppen an einem Tag bis zu 240 Punkte aufs globale Badge-Konto bekommen, während einer
mit nur einer Gruppe bei 80 bleibt. Bewusst unverändert gelassen — Entscheidung steht aus.

## Badge-Konto ebenfalls auf 80 Punkte pro Tag gedeckelt (2026-08-07)
- **Ausgangslage:** Seit dem Fix in Migration 30 gilt das Tageslimit pro Gruppe. Badges
  zählen aber über alle Gruppen zusammen — ein Partner in drei Gruppen konnte an einem Tag
  240 Punkte aufs globale Badge-Konto bekommen, einer mit einer Gruppe nur 80
- **Fix:** Für die Badge-Auswertung zählen höchstens 80 Punkte pro Kalendertag über alle
  Gruppen zusammen. **Die Rangliste bleibt unberührt** — dort zählen weiterhin die
  tatsächlich gespeicherten Punkte je Gruppe
- Das Tagesbudget wird chronologisch verteilt: Einträge zählen in der Reihenfolge ihres
  Entstehens, bis die 80 aufgebraucht sind. Das entspricht der Arbeitsweise des Triggers und
  ist nachvollziehbarer als eine anteilige Verteilung über die Kategorien
- Neue Funktion `partner_capped_entries(partner_id)` liefert alle Einträge mit gedeckelten
  Punkten; `partner_point_totals()` (Fortschrittsbalken) und `checkAndAwardBadges()`
  (Vergabe) greifen beide darauf zu, damit Anzeige und Vergabe garantiert dieselbe Rechnung
  verwenden
- Die Tagesgrenze läuft in der Zeitzone der Partner-Eigentümerin, passend zur Trigger-Logik
- **Zählbasierte Badges bleiben unverändert:** „Der Hellseher", „Spülmaschinen-Flüsterer",
  „Überraschungsei", „Gefälligkeitszögling" und „Der Allrounder" zählen Einträge, nicht
  Punkte — die Aufgabe wurde ja erledigt, auch wenn ihre Punkte gedeckelt wurden
- Neuer FAQ-Eintrag erklärt die Regel
- Migration: `supabase/migrations/20260804_31_badge_points_daily_cap.sql`

## Badge-Konto: pro Tag zählt nur die beste Gruppe (2026-08-07)
Ersetzt die Regel aus Migration 31. Der 80-Punkte-Tagesdeckel über alle Gruppen reichte
nicht: Trägt eine Nutzerin dieselbe erledigte Aufgabe in mehrere Gruppen ein, zählte sie
mehrfach aufs Badge-Konto — „Müll rausbringen" in drei Gruppen ergab 3 × 2 = 6 Punkte für
eine einzige echte Handlung, weit unterhalb jedes Deckels.

- **Neue Regel:** Für die Badge-Auswertung zählt pro Kalendertag nur die Gruppe, in der der
  Partner an dem Tag am meisten gesammelt hat
- Damit zählt eine Handlung genau einmal, und wer in vielen Gruppen mitspielt, hat keinen
  Vorteil gegenüber jemandem mit nur einer Gruppe
- Bewusst in Kauf genommen: Aufgaben, die an dem Tag nur in einer *anderen* Gruppe stehen,
  zählen nicht mit. Vom Nutzer nach Abwägung so entschieden
- Bei Gleichstand entscheidet die `group_id`, damit das Ergebnis stabil bleibt und nicht bei
  jedem Aufruf wechselt
- Der 80er-Deckel bleibt als Sicherheitsnetz bestehen, greift aber normalerweise nicht mehr:
  eine einzelne Gruppe kommt pro Tag ohnehin nicht darüber. Relevant nur für Alt-Einträge
  aus der Zeit vor Migration 17, als es noch gar kein Tageslimit gab
- **Die Ranglisten bleiben unberührt** — dort zählen weiterhin die gespeicherten Punkte je Gruppe
- Gilt automatisch auch für die zählbasierten Badges („Spülmaschinen-Flüsterer",
  „Der Hellseher", …), da auch sie nur noch Einträge der besten Gruppe sehen
- FAQ nachgezogen
- Migration: `supabase/migrations/20260804_32_badge_points_best_group.sql`

## Bugfix: Gruppe löschen zerstörte verdiente Badges (2026-08-07)
- **Fehler:** `delete_group()` löschte hart. Zwei Zeilen waren dafür verantwortlich —
  `delete from partner_badges where group_id = ...` entfernte **bereits verdiente Badges
  direkt**, `delete from point_entries where group_id = ...` entzog die Punkte vom
  Badge-Konto. Ein Partner mit 1.000 Punkten (davon 300 aus Gruppe X) stand nach dem Löschen
  von X bei 700 und verlor dadurch erreichte Meilensteine
- **Zusätzlich gefunden:** `delete_account()` hatte dasselbe Muster in einer Schleife über
  die selbst erstellten Gruppen — dort traf es sogar die Partner *anderer* Nutzerinnen
- **Lösung: Soft-Delete.** Neue Spalte `groups.deleted_at`; beim Löschen wird nur noch
  markiert. `point_entries` und `partner_badges` werden nicht mehr angefasst, die
  Badge-Summen ändern sich also um exakt null
- Gelöschte Gruppen werden überall ausgeblendet: Gruppenübersicht (`!inner` + Filter auf
  `deleted_at`), `join_group_by_invite_code()` und die Saisontitel-Vergabe
- `groups.created_by` ist jetzt nullable: löscht die Erstellerin ihr Konto, bleibt die
  Gruppe ohne Urheberin bestehen, damit die Einträge der übrigen Mitglieder ihre
  Badge-Punkte behalten
- Dialogtext und Hilfe korrigiert — sie versprachen „unwiderruflich gelöscht", was jetzt
  nicht mehr stimmt
- Migration: `supabase/migrations/20260804_33_soft_delete_groups.sql`

### Zur Frage nach der Doppelzählung beim Wiederherstellen
Das im Auftrag skizzierte Flag `already_applied_to_badges` ist mit diesem Ansatz nicht nötig
und wäre sogar schädlich. Die Doppelzählung könnte nur entstehen, wenn beim Löschen etwas
abgezogen und beim Wiederherstellen erneut addiert würde. Beim Soft-Delete wird nie etwas
abgezogen — es wird lediglich ein Sichtbarkeits-Flag umgelegt. Ein Wiederherstellen wäre
schlicht `update groups set deleted_at = null` und rechnerisch ein No-Op.

### Bewusster Kompromiss
Die Daten einer gelöschten Gruppe bleiben in der Datenbank liegen. Das ist die direkte
Konsequenz aus der Anforderung „lebenslanges Erfolgskonto" — beides gleichzeitig geht nicht.
Für die Nutzerinnen ist die Gruppe vollständig verschwunden. Sollte später echtes Löschen
nötig werden (z.B. wegen einer Löschauskunft), müsste man die Punkte vorher in ein
Aggregat je Partner überführen.

## Neue Seite: Punktehistorie (2026-08-07)
- Zeigt die vollständige Historie eines Partners über **alle** Gruppen, nach Kalenderwochen
  gruppiert: `KW 23/2023 (05.06. – 11.06.)` mit Wochensumme, darunter die Einträge
- Einträge aus weich gelöschten Gruppen werden als „gelöschte Gruppe" gekennzeichnet statt
  mit dem Gruppennamen — sie zählen weiter aufs Erfolgskonto (siehe Migration 33)
- Wochen ohne Einträge entstehen gar nicht erst, da nur vorhandene Einträge gruppiert werden
- Bonus-Einträge tragen den Blitz und „ohne Aufforderung"
- Erreichbar von der Badge-Seite (Frauen-Ansicht) und aus dem Männerprofil
- Neue Funktion `partner_point_history(partner_id)`, SECURITY DEFINER mit derselben
  Zugriffsprüfung wie `partner_capped_entries()`. Nötig, weil die RLS auf `point_entries` an
  die Gruppenmitgliedschaft gebunden ist — Männer stehen nie in `group_members` und könnten
  ihre eigene Historie sonst nicht sehen
- Gezeigt werden die **tatsächlich vergebenen** Punkte je Gruppe, nicht die für Badges
  gedeckelten: die Historie protokolliert, was in der jeweiligen Gruppe passiert ist
- ISO-8601-Wochenberechnung (Montag als Wochenstart, Donnerstag entscheidet über das Jahr),
  getestet an den Jahreswechsel-Fällen: 31.12.2024 → KW 1/2025, 01.01.2023 → KW 52/2022
- Migration: `supabase/migrations/20260804_34_point_history.sql`

## Bugfix: Badge-Seite weiterer Partner war nicht erreichbar (2026-08-07)
- **Fehler:** `loadUserData` merkte sich nur `pts[0]`, und der Header-Link auf der
  Gruppenübersicht war der einzige Weg zur Badge-Seite. Bei mehreren Partnern kam man
  ausschließlich zum ersten — alle weiteren waren komplett unerreichbar, samt ihrer
  Punktehistorie
- `loadUserData` füllt jetzt `myAllPartners` mit allen eigenen Partnern (vorher nur in
  `openGroup` gesetzt, also erst nach dem Öffnen einer Gruppe verfügbar)
- **Zwei Einstiege statt einem:**
  - Gruppenübersicht: bei mehreren Partnern eine horizontal scrollbare Leiste mit
    Avatar + Name je Partner. Bei genau einem Partner bleibt der bisherige große Kopfbereich
  - Profil & Einstellungen: jede Partner-Karte bekommt „Badges & Erfolge ansehen" — dort
    sind ohnehin alle Partner gelistet
- Der Zurück-Button der Badge-Seite führt jetzt dorthin zurück, wo man hergekommen ist
  (`badgesReturnScreen`), statt immer zur Gruppenübersicht

### Dabei mitgefundene Folgefehler
- `handleAddPartnerFromProfile` pflegte nur `myPartners`, nicht `myAllPartners` — ein neu
  angelegter Partner fehlte in der Kopfleiste und bei der Punktevergabe bis zum nächsten
  Neustart
- `handleDeletePartner` setzte `partner` auf `null`, wenn der Haupt-Partner gelöscht wurde.
  Die Übersicht zeigte dann „Meine Gruppen", obwohl noch weitere Partner existierten — jetzt
  wird auf den nächsten verbleibenden gewechselt

## Fix: „Ohne Aufforderung"-Schalter war praktisch unauffindbar (2026-08-07)
- Der Schalter existierte, stand im Punktevergeben-Screen aber **hinter allen 34
  Kategorie-Karten**. Nach der Auswahl einer der oberen Aufgaben hätte man an rund 30 Karten
  vorbeiscrollen müssen, um ihn zu sehen
- Verschoben in den Footer, direkt über den Speichern-Button: dort erscheint er in dem
  Moment, in dem eine passende Kategorie gewählt wird, und ist ohne Scrollen sichtbar
- Aktiver Zustand jetzt durchgehend in `COLORS.gold` (Rahmen und Schalter), passend zum
  goldenen Blitz — vorher war der Schalter terrakottafarben und damit nicht vom normalen
  Aktionszustand zu unterscheiden
- Unverändert: Der Schalter erscheint nur bei Haushalt und Mental Load
  (`multiplier_eligible`), so wie im Balancing-Konzept festgelegt — 20 der 34 Aufgaben

## „Der Merker" löst jetzt unabhängig von der Gruppenauswahl aus (2026-08-07)
- **Problem:** Seit Migration 32 zählen für Badges nur die Einträge der punktstärksten Gruppe
  des Tages. Stand der Jahrestag-/Geburtstag-Eintrag zufällig in einer anderen Gruppe, fiel
  er heraus und „Der Merker" kam nie — obwohl der Partner ihn verdient hatte
- Bei einem Badge, das es genau **einmal** gibt, kann Mehrfacheintragung ohnehin nichts
  aufblähen. Die Dedup-Regel schützt dort also vor nichts und schadet nur
- **Lösung:** `partner_capped_entries()` liefert jetzt alle Einträge und markiert über die
  neue Spalte `counts_for_badges`, welche in die Wertung eingehen (`LEFT JOIN` statt
  `INNER JOIN` auf die beste Gruppe). Einträge außerhalb tragen weiterhin 0 Punkte bei
- Im Client: alle Zähler- und Punkte-Badges nutzen unverändert nur die gewerteten Einträge,
  ausschließlich `hasAnniversaryEntry` sieht die vollständige Menge
- `partner_point_totals()` bleibt korrekt, da es `counted_points` summiert und diese
  außerhalb der besten Gruppe 0 sind
- Migration: `supabase/migrations/20260804_35_merker_unfiltered.sql`

---

# Aufräum-Audit: Punkte 6, 7, 8 und 10 (2026-08-07)

Migration: `supabase/migrations/20260804_36_cleanup_rename_orphans.sql`

## 6 – Tote Emoji-Spalten entfernt
- `badges.icon` und `point_categories.icon` stammen aus Migration 04/09. Seit Migration 24
  läuft die Darstellung über `icon_key` und `theme/icons.ts`
- Vor dem Drop geprüft: In `App.tsx` und `BadgeGrid.tsx` kommt ausschließlich `icon_key` vor.
  Die beiden `item.icon`-Fundstellen im Hilfe-Screen sind lokale Literale mit `ICONS.*`-Namen,
  keine Datenbankspalte. Das Anlegen eigener Kategorien schreibt `icon` nicht mehr mit
- `badges.icon` war `not null`, wurde aber nur von Migrationen befüllt — kein Insert-Pfad
  in der App betroffen. `select('*')` auf `badges` liefert die Spalte künftig einfach nicht mehr
- Die enthaltenen Emojis gehen verloren; sie waren ohnehin über kein UI mehr erreichbar

## 7 – Gruppen umbenennen
- Auf `groups` gab es überhaupt keine UPDATE-Möglichkeit: ein Tippfehler im Gruppennamen
  war dauerhaft
- **Bewusst als RPC `rename_group(group_id, name)` statt als UPDATE-Policy.** Eine Policy
  wirkt immer auf die ganze Zeile, RLS kann keine einzelnen Spalten schützen — die
  Erstellerin hätte damit auch `invite_code` ändern können und allen Mitgliedern still den
  Einladungslink entwertet. Die RPC schreibt ausschließlich `name` und folgt damit dem
  Muster von `delete_group()` und `leave_group()`
- Serverseitig geprüft: Name nicht leer (getrimmt), nur die Erstellerin, nicht bei weich
  gelöschten Gruppen
- UI: neuer Screen `rename-group` und ein „Umbenennen"-Link neben „Gruppe löschen" auf der
  Gruppenkarte — nur für Erstellerinnen sichtbar, wie beim Löschen
- Nach dem Speichern wird auch `selectedGroup` aktualisiert, sonst stünde im Kopf des
  Gruppen-Details weiter der alte Name
- Hilfe-Seite und FAQ um je einen Eintrag ergänzt (inkl. Hinweis, dass der Code gleich bleibt)

## 8 – Verwaiste Gruppen
- Verließ das letzte Mitglied eine Gruppe, blieb sie mit allen Daten bestehen — unsichtbar
  für alle (die Übersicht läuft über `group_members`) und von niemandem mehr löschbar
- `leave_group()` markiert die Gruppe jetzt weich als gelöscht, wenn danach kein Mitglied
  mehr übrig ist
- **Dabei gefunden:** `delete_account()` hatte dieselbe Lücke durch eine andere Tür. Schritt 6
  löscht alle Mitgliedschaften der Person, ohne die betroffenen Gruppen danach zu prüfen.
  Selbst erstellte Gruppen fängt Schritt 1 ab — war die Person dagegen in einer *fremden*
  Gruppe das letzte verbliebene Mitglied, blieb dieselbe Karteileiche zurück. Neuer
  Schritt 6a schließt das, die betroffenen Gruppen-IDs werden vor dem Löschen gemerkt
- Bestehende mitgliederlose Gruppen werden per Backfill nachträglich markiert

## 10 – `profiles.role` entfernt
- Die Spalte wurde per Trigger (`set_woman_role`) und in `connect_to_partner()` gepflegt,
  aber nirgends zur Autorisierung ausgewertet — weder in der App noch in einer Policy.
  Sie suggerierte eine Rollenprüfung, die es nie gab
- Geprüft: In `App.tsx` und den Komponenten kommt `role` kein einziges Mal vor. Die
  Unterscheidung Frau/Mann ergibt sich ausschließlich aus der Datenlage (eigener Partner
  vs. Verbindung über `partner_connections`), so wie es `loadUserData` schon immer macht
- `set_my_timezone()` und `connect_to_partner()` schreiben die Spalte nicht mehr; beide
  werden vor dem Drop neu angelegt, damit sie nie auf eine fehlende Spalte verweisen
- `profiles` bleibt bestehen — `timezone` wird von der Anti-Farming-Logik aktiv genutzt
