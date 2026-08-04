-- Migration: Tier-basiertes Punktesystem
-- Datum: 2026-08-04
-- Ersetzt die freien Punktewerte durch 5 feste Tiers (2/5/10/20/40),
-- fuehrt die Kategorie "Mental Load" ein und einen "ohne Aufforderung"-Multiplikator.

-- 1. Schema-Erweiterung
alter table point_categories add column if not exists tier integer;
alter table point_categories add column if not exists multiplier_eligible boolean not null default false;
alter table point_entries add column if not exists without_request boolean not null default false;

-- tier muss zwischen 1 und 5 liegen (falls gesetzt)
alter table point_categories
  add constraint point_categories_tier_check check (tier is null or tier between 1 and 5);

-- points muss zum Tier passen (falls Tier gesetzt) -- NOT VALID: bestehende Alt-Daten
-- werden nicht rueckwirkend geprueft, neue/geaenderte Zeilen aber schon.
alter table point_categories
  add constraint point_categories_points_tier_check check (
    tier is null or points = case tier
      when 1 then 2 when 2 then 5 when 3 then 10 when 4 then 20 when 5 then 40
    end
  ) not valid;

-- eigene (nicht-globale) Kategorien muessen ab sofort ein Tier waehlen
-- (kein freies Zahlenfeld mehr) -- ebenfalls NOT VALID fuer Alt-Daten.
alter table point_categories
  add constraint point_categories_custom_tier_required check (
    is_global = true or tier is not null
  ) not valid;

-- 2. Alte Standard-Kategorien + abhaengige Alt-Daten entfernen
delete from group_category_overrides
  where category_id in (select id from point_categories where is_global = true);
delete from point_entries
  where category_id in (select id from point_categories where is_global = true);
delete from point_categories where is_global = true;

-- 3. Neuer Kategorienkatalog (4 Kategorien, Tier-basiert)
insert into point_categories (name, points, icon, is_global, category_tag, tier, multiplier_eligible) values
-- Haushalt (Multiplikator "ohne Aufforderung" erlaubt)
('Müll rausbringen', 2, '🧹', true, 'haushalt', 1, true),
('Geschirrspüler aus-/einräumen', 2, '🧹', true, 'haushalt', 1, true),
('Tisch decken / abräumen', 2, '🧹', true, 'haushalt', 1, true),
('Wäsche in die Maschine', 5, '🧹', true, 'haushalt', 2, true),
('Wäsche aufhängen / zusammenlegen', 5, '🧹', true, 'haushalt', 2, true),
('Staubsaugen', 5, '🧹', true, 'haushalt', 2, true),
('Einkauf erledigt', 10, '🧹', true, 'haushalt', 3, true),
('Gekocht (Alltagsessen)', 10, '🧹', true, 'haushalt', 3, true),
('Bad geputzt', 10, '🧹', true, 'haushalt', 3, true),
('Küche gründlich geputzt', 10, '🧹', true, 'haushalt', 3, true),
('Gekocht (aufwendiges Menü)', 20, '🧹', true, 'haushalt', 4, true),
('Großputz / Frühjahrsputz', 20, '🧹', true, 'haushalt', 4, true),
('Keller / Garage / Dachboden ausgemistet', 40, '🧹', true, 'haushalt', 5, true),
-- Mental Load (Multiplikator erlaubt)
('An einen Termin erinnert', 5, '🧠', true, 'mental_load', 2, true),
('Termin selbst vereinbart', 5, '🧠', true, 'mental_load', 2, true),
('Geschenk für Dritte besorgt', 10, '🧠', true, 'mental_load', 3, true),
('Arzt-/Kindertermin organisiert', 10, '🧠', true, 'mental_load', 3, true),
('Behördenkram erledigt', 20, '🧠', true, 'mental_load', 4, true),
('Handwerker organisiert & koordiniert', 20, '🧠', true, 'mental_load', 4, true),
('Urlaub geplant und gebucht', 20, '🧠', true, 'mental_load', 4, true),
-- Romantik & Aufmerksamkeit (kein Multiplikator)
('Kompliment, das sitzt', 2, '💐', true, 'romantik', 1, false),
('Liebe Nachricht tagsüber', 2, '💐', true, 'romantik', 1, false),
('Lieblingssnack mitgebracht', 5, '💐', true, 'romantik', 2, false),
('Handschriftliche Nachricht', 10, '💐', true, 'romantik', 3, false),
('Blumen / kleine Überraschung', 10, '💐', true, 'romantik', 3, false),
('Date-Night geplant und durchgezogen', 20, '💐', true, 'romantik', 4, false),
('Jahrestag / Geburtstag perfekt gemeistert', 20, '💐', true, 'romantik', 4, false),
('Wochenendtrip organisiert', 40, '💐', true, 'romantik', 5, false),
-- Verlässlichkeit & Partnerschaft (kein Multiplikator)
('Pünktlich und vorbereitet', 5, '🛡️', true, 'verlaesslichkeit', 2, false),
('Zugehört, Handy weggelegt', 5, '🛡️', true, 'verlaesslichkeit', 2, false),
('Kinder übernommen (mehrere Stunden)', 10, '🛡️', true, 'verlaesslichkeit', 3, false),
('Elternabend / Schulkram übernommen', 10, '🛡️', true, 'verlaesslichkeit', 3, false),
('Konflikt fair und ruhig gelöst', 10, '🛡️', true, 'verlaesslichkeit', 3, false),
('Schwierigen Familienbesuch souverän gemeistert', 20, '🛡️', true, 'verlaesslichkeit', 4, false);
