-- Migration: Komplettes Badge-System (5 Typen)
-- Datum: 2026-08-05
-- Ersetzt die 6 alten, unstrukturierten Badges aus Migration 09 durch den
-- vollstaendigen Katalog aus dem Balancing-Konzept. Baut auf badge_type/
-- is_hidden/is_repeatable/period_key aus Migration 18 auf.
--
-- Scope-Entscheidung: Typ 1 (Meilensteine), Typ 2 (Spezialisten), Typ 3
-- (Konsistenz) und Typ 5 (versteckt) werden ueber ALLE Gruppen des Partners
-- hinweg berechnet (globale Punktesumme), aber der partner_badges-Eintrag
-- wird mit der group_id der Gruppe gespeichert, in der die ausloesende
-- Punktevergabe stattfand (kein Schema-Umbau auf nullable group_id noetig).
-- Nur Typ 4 (Saisontitel) ist echt pro Gruppe (siehe Migration 18).

-- 1. Alte, nicht-typisierte Badges aus Migration 09 entfernen
delete from partner_badges
  where badge_id in (select id from badges where badge_type is null);
delete from badges where badge_type is null;

-- 2. Typ 1: Meilensteine (dauerhaft, kumulativ, global)
insert into badges (name, description, icon, trigger_type, trigger_value, badge_type, is_repeatable, is_hidden) values
('Rookie', 'Insgesamt 50 Punkte gesammelt', '🔰', 'total_points', 50, 1, false, false),
('Stammspieler', 'Insgesamt 250 Punkte gesammelt', '⭐', 'total_points', 250, 1, false, false),
('Leistungsträger', 'Insgesamt 1.000 Punkte gesammelt', '💪', 'total_points', 1000, 1, false, false),
('Legende', 'Insgesamt 2.500 Punkte gesammelt', '👑', 'total_points', 2500, 1, false, false),
('Unsterblich', 'Insgesamt 5.000 Punkte gesammelt', '♾️', 'total_points', 5000, 1, false, false);

-- 3. Typ 2: Kategorie-Spezialisten (dauerhaft, dreistufig, global)
insert into badges (name, description, icon, trigger_type, trigger_value, category_filter, badge_type, is_repeatable, is_hidden) values
('Der Anpacker', 'Bronze · 200 Punkte in Haushalt', '🧹', 'category_points', 200, 'haushalt', 2, false, false),
('Haushaltsheld', 'Silber · 750 Punkte in Haushalt', '🧹', 'category_points', 750, 'haushalt', 2, false, false),
('Der Hausgott', 'Gold · 2.000 Punkte in Haushalt', '🧹', 'category_points', 2000, 'haushalt', 2, false, false),
('Mitdenker', 'Bronze · 150 Punkte in Mental Load', '🧠', 'category_points', 150, 'mental_load', 2, false, false),
('Der wandelnde Kalender', 'Silber · 500 Punkte in Mental Load', '🧠', 'category_points', 500, 'mental_load', 2, false, false),
('Das Familiengehirn', 'Gold · 1.500 Punkte in Mental Load', '🧠', 'category_points', 1500, 'mental_load', 2, false, false),
('Charmeur', 'Bronze · 100 Punkte in Romantik', '💐', 'category_points', 100, 'romantik', 2, false, false),
('Romantiker', 'Silber · 400 Punkte in Romantik', '💐', 'category_points', 400, 'romantik', 2, false, false),
('Herzensbrecher', 'Gold · 1.000 Punkte in Romantik', '💐', 'category_points', 1000, 'romantik', 2, false, false),
('Der Verlässliche', 'Bronze · 150 Punkte in Verlässlichkeit', '🛡️', 'category_points', 150, 'verlaesslichkeit', 2, false, false),
('Fels in der Brandung', 'Silber · 500 Punkte in Verlässlichkeit', '🛡️', 'category_points', 500, 'verlaesslichkeit', 2, false, false),
('Ehrenmann', 'Gold · 1.500 Punkte in Verlässlichkeit', '🛡️', 'category_points', 1500, 'verlaesslichkeit', 2, false, false);

-- 4. Typ 3: Konsistenz (wiederholbar, resetbar, global)
insert into badges (name, description, icon, trigger_type, trigger_value, badge_type, is_repeatable, is_hidden) values
('Die Serie', '4 Wochen in Folge mind. 20 Punkte', '🔥', 'streak_weeks', 4, 3, true, false),
('Marathonmann', '12 Wochen in Folge mind. 20 Punkte', '🏃', 'streak_weeks', 12, 3, true, false),
('Ironman', '24 Wochen in Folge mind. 20 Punkte', '🦾', 'streak_weeks', 24, 3, true, false),
('Comeback des Jahres', 'Nach 3+ Wochen Pause wieder 30 Punkte in einer Woche', '🎬', 'comeback', 30, 3, true, false);

-- Typ 4 (Saisontitel) wurde bereits in Migration 18 angelegt.

-- 5. Typ 5: versteckte Charakter-Badges (Ueberraschung, Humor, global)
insert into badges (name, description, icon, trigger_type, trigger_value, badge_type, is_repeatable, is_hidden) values
('Der Hellseher', '5× "ohne Aufforderung" in einer Woche', '🔮', 'hellseher', 5, 5, false, true),
('Der Allrounder', 'In einer Woche in allen 4 Kategorien gepunktet', '🎭', 'allrounder', 4, 5, false, true),
('Spülmaschinen-Flüsterer', '50× Geschirrspüler ein-/ausgeräumt', '🍽️', 'dishwasher_count', 50, 5, false, true),
('Der Merker', 'Jahrestag/Geburtstag-Aufgabe eingetragen', '💍', 'anniversary', 1, 5, false, true),
('Überraschungsei', '3× Tier-4-Aufgabe in einem Monat', '🥚', 'tier4_month', 3, 5, false, true),
('Gefälligkeitszögling', '15 eigens erstellte Aufgaben erfüllt', '🎨', 'custom_category_count', 15, 5, false, true);
