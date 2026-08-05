-- Migration: Design-System — icon_key, tier und image_url
-- Datum: 2026-08-06
--
-- Loest die bisher gespeicherten Emojis durch semantische Icon-Schluessel ab
-- (aufgeloest in theme/icons.ts). Das UI kennt damit keine Emojis mehr, und
-- einzelne Badges koennen spaeter ueber image_url gegen Illustrationen
-- getauscht werden, ohne die Komponente umzubauen.

-- ── 1. Neue Spalten ─────────────────────────────────────────────
alter table badges add column if not exists image_url text;
alter table badges add column if not exists tier smallint;
alter table badges add column if not exists icon_key text;

alter table badges drop constraint if exists badges_tier_check;
alter table badges add constraint badges_tier_check
  check (tier is null or tier between 1 and 3);

-- Kategorien speichern ihren Icon-Schluessel ebenfalls semantisch
alter table point_categories add column if not exists icon_key text;

-- ── 2. Badges: icon_key + tier setzen ───────────────────────────
-- tier ist nur bei den Spezialisten-Badges (Typ 2) gesetzt, sonst NULL.
update badges b set icon_key = v.icon_key, tier = v.tier
from (values
  -- Typ 1: Meilensteine
  ('Rookie',                   'badgeRookie',              null::smallint),
  ('Stammspieler',             'badgeRegular',             null),
  ('Leistungsträger',          'badgePerformer',           null),
  ('Legende',                  'badgeLegend',              null),
  ('Unsterblich',              'badgeImmortal',            null),
  -- Typ 2: Kategorie-Spezialisten (Stufe 1/2/3)
  ('Der Anpacker',             'badgeHousehold1',          1),
  ('Haushaltsheld',            'badgeHousehold2',          2),
  ('Der Hausgott',             'badgeHousehold3',          3),
  ('Mitdenker',                'badgeMental1',             1),
  ('Der wandelnde Kalender',   'badgeMental2',             2),
  ('Das Familiengehirn',       'badgeMental3',             3),
  ('Charmeur',                 'badgeRomance1',            1),
  ('Romantiker',               'badgeRomance2',            2),
  ('Herzensbrecher',           'badgeRomance3',            3),
  ('Der Verlässliche',         'badgeReliability1',        1),
  ('Fels in der Brandung',     'badgeReliability2',        2),
  ('Ehrenmann',                'badgeReliability3',        3),
  -- Typ 3: Konsistenz
  ('Die Serie',                'badgeStreak4',             null),
  ('Marathonmann',             'badgeStreak12',            null),
  ('Ironman',                  'badgeStreak24',            null),
  ('Comeback des Jahres',      'badgeComeback',            null),
  -- Typ 4: Saisontitel
  ('Spieler der Woche',        'badgeWeekWinner',          null),
  ('Monatssieger',             'badgeMonthWinner',         null),
  ('Saisonsieger',             'badgeSeasonWinner',        null),
  -- Typ 5: versteckte Charakter-Badges
  ('Der Hellseher',            'badgeClairvoyant',         null),
  ('Der Allrounder',           'badgeAllrounder',          null),
  ('Spülmaschinen-Flüsterer',  'badgeDishwasherWhisperer', null),
  ('Der Merker',               'badgeRemembers',           null),
  ('Überraschungsei',          'badgeSurprise',            null),
  ('Gefälligkeitszögling',     'badgeEagerStudent',        null)
) as v(name, icon_key, tier)
where b.name = v.name;

-- ── 3. Kategorien: Emoji-Icons durch icon_key ersetzen ──────────
update point_categories c set icon_key = v.icon_key
from (values
  -- Haushalt
  ('Müll rausbringen',                              'taskTrash'),
  ('Geschirrspüler aus-/einräumen',                 'taskDishwasher'),
  ('Tisch decken / abräumen',                       'taskTable'),
  ('Wäsche in die Maschine',                        'taskLaundryIn'),
  ('Wäsche aufhängen / zusammenlegen',              'taskLaundryFold'),
  ('Staubsaugen',                                   'taskVacuum'),
  ('Einkauf erledigt',                              'taskGroceries'),
  ('Gekocht (Alltagsessen)',                        'taskCookDaily'),
  ('Bad geputzt',                                   'taskBathroom'),
  ('Küche gründlich geputzt',                       'taskKitchen'),
  ('Gekocht (aufwendiges Menü)',                    'taskCookFancy'),
  ('Großputz / Frühjahrsputz',                      'taskDeepClean'),
  ('Keller / Garage / Dachboden ausgemistet',       'taskDeclutter'),
  -- Mental Load
  ('An einen Termin erinnert',                      'taskRemindAppointment'),
  ('Termin selbst vereinbart',                      'taskMakeAppointment'),
  ('Geschenk für Dritte besorgt',                   'taskGiftForOthers'),
  ('Arzt-/Kindertermin organisiert',                'taskMedicalAppointment'),
  ('Behördenkram erledigt',                         'taskPaperwork'),
  ('Handwerker organisiert & koordiniert',          'taskCraftsmen'),
  ('Urlaub geplant und gebucht',                    'taskVacationPlanning'),
  -- Romantik & Aufmerksamkeit
  ('Kompliment, das sitzt',                         'taskCompliment'),
  ('Liebe Nachricht tagsüber',                      'taskSweetMessage'),
  ('Lieblingssnack mitgebracht',                    'taskFavoriteSnack'),
  ('Handschriftliche Nachricht',                    'taskHandwrittenNote'),
  ('Blumen / kleine Überraschung',                  'taskFlowers'),
  ('Date-Night geplant und durchgezogen',           'taskDateNight'),
  ('Jahrestag / Geburtstag perfekt gemeistert',     'taskAnniversary'),
  ('Wochenendtrip organisiert',                     'taskWeekendTrip'),
  -- Verlässlichkeit & Partnerschaft
  ('Pünktlich und vorbereitet',                     'taskPunctual'),
  ('Zugehört, Handy weggelegt',                     'taskPhoneAway'),
  ('Kinder übernommen (mehrere Stunden)',           'taskChildcare'),
  ('Elternabend / Schulkram übernommen',            'taskSchoolStuff'),
  ('Konflikt fair und ruhig gelöst',                'taskConflictResolved'),
  ('Schwierigen Familienbesuch souverän gemeistert', 'taskFamilyVisit')
) as v(name, icon_key)
where c.name = v.name and c.is_global = true;

-- Selbst angelegte Gruppenkategorien haben keinen festen Schluessel.
-- Sie bekommen den Sammel-Schluessel ihrer Kategorie bzw. ein neutrales
-- Icon, damit nirgendwo mehr ein Emoji gerendert wird.
update point_categories set icon_key = case category_tag
    when 'haushalt'         then 'categoryHousehold'
    when 'mental_load'      then 'categoryMentalLoad'
    when 'romantik'         then 'categoryRomance'
    when 'verlaesslichkeit' then 'categoryReliability'
    else 'actionAddPoints'
  end
where icon_key is null;

-- ── 4. Kontrolle ────────────────────────────────────────────────
-- Sollte 0 Zeilen liefern:
-- select name from badges where icon_key is null;
-- select name from point_categories where icon_key is null;
