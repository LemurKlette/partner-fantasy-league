-- Migration: feste Sortierreihenfolge fuer Badges
-- Datum: 2026-08-05
-- Bisher wurde nur nach badge_type sortiert, innerhalb eines Typs war die
-- Reihenfolge undefiniert (keine Garantie ohne ORDER BY-Spalte). Jetzt gibt
-- es eine explizite sort_order-Spalte.

alter table badges add column if not exists sort_order integer;

-- Typ 1: Meilensteine, aufsteigend nach Schwelle
update badges set sort_order = 1 where name = 'Rookie';
update badges set sort_order = 2 where name = 'Stammspieler';
update badges set sort_order = 3 where name = 'Leistungsträger';
update badges set sort_order = 4 where name = 'Legende';
update badges set sort_order = 5 where name = 'Unsterblich';

-- Typ 2: Kategorie-Spezialisten, gruppiert nach Kategorie, je Bronze/Silber/Gold
update badges set sort_order = 10 where name = 'Der Anpacker';
update badges set sort_order = 11 where name = 'Haushaltsheld';
update badges set sort_order = 12 where name = 'Der Hausgott';
update badges set sort_order = 13 where name = 'Mitdenker';
update badges set sort_order = 14 where name = 'Der wandelnde Kalender';
update badges set sort_order = 15 where name = 'Das Familiengehirn';
update badges set sort_order = 16 where name = 'Charmeur';
update badges set sort_order = 17 where name = 'Romantiker';
update badges set sort_order = 18 where name = 'Herzensbrecher';
update badges set sort_order = 19 where name = 'Der Verlässliche';
update badges set sort_order = 20 where name = 'Fels in der Brandung';
update badges set sort_order = 21 where name = 'Ehrenmann';

-- Typ 3: Konsistenz, aufsteigend nach Dauer
update badges set sort_order = 30 where name = 'Die Serie';
update badges set sort_order = 31 where name = 'Marathonmann';
update badges set sort_order = 32 where name = 'Ironman';
update badges set sort_order = 33 where name = 'Comeback des Jahres';

-- Typ 4: Saisontitel, Woche -> Monat -> Jahr
update badges set sort_order = 40 where name = 'Spieler der Woche';
update badges set sort_order = 41 where name = 'Monatssieger';
update badges set sort_order = 42 where name = 'Saisonsieger';

-- Typ 5: versteckte Charakter-Badges
update badges set sort_order = 50 where name = 'Der Hellseher';
update badges set sort_order = 51 where name = 'Der Allrounder';
update badges set sort_order = 52 where name = 'Spülmaschinen-Flüsterer';
update badges set sort_order = 53 where name = 'Der Merker';
update badges set sort_order = 54 where name = 'Überraschungsei';
update badges set sort_order = 55 where name = 'Gefälligkeitszögling';
