-- Migration: Badge-Beschreibungen als Erklaerungstexte
-- Datum: 2026-08-06
--
-- Die Spalte badges.description existiert bereits seit Migration 09 und
-- enthaelt bisher eher Etiketten ("Bronze · 200 Punkte in Haushalt").
-- Fuer das neue Info-Modal braucht es Texte, die erklaeren, WIE man ein
-- Badge bekommt. Diese Migration schreibt alle 30 Beschreibungen neu.

update badges b set description = v.description
from (values
  -- Typ 1: Meilensteine (Gesamtpunkte ueber alle Gruppen)
  ('Rookie',                   'Sammle insgesamt 50 Punkte.'),
  ('Stammspieler',             'Sammle insgesamt 250 Punkte.'),
  ('Leistungsträger',          'Sammle insgesamt 1.000 Punkte.'),
  ('Legende',                  'Sammle insgesamt 2.500 Punkte.'),
  ('Unsterblich',              'Sammle insgesamt 5.000 Punkte.'),

  -- Typ 2: Kategorie-Spezialisten
  ('Der Anpacker',             'Sammle 200 Punkte in der Kategorie Haushalt.'),
  ('Haushaltsheld',            'Sammle 750 Punkte in der Kategorie Haushalt.'),
  ('Der Hausgott',             'Sammle 2.000 Punkte in der Kategorie Haushalt.'),
  ('Mitdenker',                'Sammle 150 Punkte in der Kategorie Mental Load.'),
  ('Der wandelnde Kalender',   'Sammle 500 Punkte in der Kategorie Mental Load.'),
  ('Das Familiengehirn',       'Sammle 1.500 Punkte in der Kategorie Mental Load.'),
  ('Charmeur',                 'Sammle 100 Punkte in der Kategorie Romantik & Aufmerksamkeit.'),
  ('Romantiker',               'Sammle 400 Punkte in der Kategorie Romantik & Aufmerksamkeit.'),
  ('Herzensbrecher',           'Sammle 1.000 Punkte in der Kategorie Romantik & Aufmerksamkeit.'),
  ('Der Verlässliche',         'Sammle 150 Punkte in der Kategorie Verlässlichkeit & Partnerschaft.'),
  ('Fels in der Brandung',     'Sammle 500 Punkte in der Kategorie Verlässlichkeit & Partnerschaft.'),
  ('Ehrenmann',                'Sammle 1.500 Punkte in der Kategorie Verlässlichkeit & Partnerschaft.'),

  -- Typ 3: Konsistenz (wiederholbar)
  ('Die Serie',                'Hole 4 Wochen in Folge mindestens 20 Punkte pro Woche.'),
  ('Marathonmann',             'Hole 12 Wochen in Folge mindestens 20 Punkte pro Woche.'),
  ('Ironman',                  'Hole 24 Wochen in Folge mindestens 20 Punkte pro Woche.'),
  ('Comeback des Jahres',      'Hole nach mindestens 3 Wochen Pause wieder 30 Punkte in einer Woche.'),

  -- Typ 4: Saisontitel (pro Gruppe, wiederholbar)
  ('Spieler der Woche',        'Beende eine Woche auf Platz 1 des Gruppen-Rankings.'),
  ('Monatssieger',             'Beende einen Monat auf Platz 1 des Gruppen-Rankings.'),
  ('Saisonsieger',             'Beende ein Jahr auf Platz 1 des Gruppen-Rankings.'),

  -- Typ 5: versteckte Charakter-Badges
  ('Der Hellseher',            'Erledige 5 Aufgaben in einer Woche ohne Aufforderung.'),
  ('Der Allrounder',           'Punkte in einer Woche in allen vier Kategorien.'),
  ('Spülmaschinen-Flüsterer',  'Räume den Geschirrspüler insgesamt 50-mal ein oder aus.'),
  ('Der Merker',               'Denke an einen Jahrestag oder Geburtstag.'),
  ('Überraschungsei',          'Erledige in einem Monat 3 Aufgaben der Stufe 4 (20 Punkte).'),
  ('Gefälligkeitszögling',     'Erfülle 15 Aufgaben aus selbst erstellten Kategorien.')
) as v(name, description)
where b.name = v.name;

-- Kontrolle: sollte 0 Zeilen liefern
-- select name from badges where description is null or description = '';
