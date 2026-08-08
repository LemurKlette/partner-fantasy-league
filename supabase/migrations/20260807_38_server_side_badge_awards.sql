-- Migration: Audit-Punkte 3 und 5
--   3) Badge-Vergabe laeuft nicht mehr im Client
--   5) group_category_overrides aufgeraeumt (toter Ballast)
-- Datum: 2026-08-07, ueberarbeitet 2026-08-08
--
-- ═══════════════════════════════════════════════════════════════
-- WARUM DIESE MIGRATION UEBERARBEITET WURDE
-- ═══════════════════════════════════════════════════════════════
-- Die erste Fassung war nicht ausfuehrbar. Behoben wurden:
--   a) CREATE TRIGGER mit Argument (NEW.partner_id) -- Syntaxfehler
--   b) Triggerfunktion war "returns void" statt "returns trigger"
--   c) INSERT mit group_id = null gegen eine NOT-NULL-Spalte
--   d) ON CONFLICT auf eine Spaltenkombination ohne passenden Index
--   e) "drop policy" auf einen Namen, den es nie gab -- die alte,
--      permissive INSERT-Policy waere stehengeblieben und haette die
--      neue Sperre per ODER-Verknuepfung aufgehoben
--   f) "grant execute ... to authenticated" auf die Vergabe-Funktion:
--      jede angemeldete Person haette fremden Partnern Badges
--      verleihen koennen
--
-- Zusaetzlich beim Ueberarbeiten gefunden und mitbehoben:
--   g) hstore wird benutzt, ist aber in diesem Projekt nicht
--      installiert -- die Funktion haette sich nicht anlegen lassen
--   h) "where is_hidden = false" schloss genau die sechs versteckten
--      Badges aus, fuer die es darunter Auswertungszweige gibt
--   i) Endlosschleife in der Streak-Berechnung (fehlender Schluessel
--      liefert NULL, "exit when NULL" beendet die Schleife nie)
--   j) sql_week_key() lag einen Tag daneben ((dow+5)%7 statt (dow+6)%7)
--   k) "Der Hellseher" wertete den Jahrestag statt "ohne Aufforderung",
--      "Der Allrounder" zaehlte ueber alle Zeit statt ueber die Woche
--
-- ═══════════════════════════════════════════════════════════════
-- PRODUKTENTSCHEIDUNG: Badges sind global, Saisontitel nicht
-- ═══════════════════════════════════════════════════════════════
-- Meilensteine, Spezialisten, Konsistenz und die versteckten Badges
-- (badge_type 1, 2, 3, 5) gelten fuer den Partner als Person, ueber
-- alle Gruppen hinweg -- sie werden mit group_id = NULL gespeichert.
-- Nur Saisontitel (badge_type 4) bleiben an eine Gruppe gebunden.
--
-- ACHTUNG, ZWEITE SCHEMA-AENDERUNG: period_key ist heute nullable und
-- steht bei allen nicht-saisonalen Badges auf NULL. In einem Unique-
-- Index gilt NULL != NULL -- jede Vergabe wuerde eine neue Zeile
-- anlegen statt zu kollidieren. Deshalb wird period_key auf
-- NOT NULL DEFAULT '' gezogen und der Leerstring bedeutet
-- "kein Zeitraum". Alternative waere ein Ausdrucksindex ueber
-- coalesce(period_key, ''); die Sentinel-Loesung ist lesbarer und
-- macht die ON-CONFLICT-Klauseln eindeutig.

-- ═══════════════════════════════════════════════════════════════
-- 0: Schema -- group_id nullable, period_key NOT NULL, Indizes
-- ═══════════════════════════════════════════════════════════════

alter table partner_badges alter column group_id drop not null;

update partner_badges set period_key = '' where period_key is null;
alter table partner_badges alter column period_key set default '';
alter table partner_badges alter column period_key set not null;

-- Bestandsdaten auf das neue Modell ziehen. Bisher trugen auch globale
-- Badges die group_id der ausloesenden Gruppe (siehe Migration 19).
-- Steht derselbe Badge dadurch mehrfach da, bleibt der aelteste Eintrag.
-- Erst entdoppeln, dann auf NULL setzen -- danach greift der Unique-Index.
delete from partner_badges pb
 where pb.badge_id in (select id from badges where badge_type is distinct from 4)
   and exists (
     select 1 from partner_badges keep
      where keep.partner_id = pb.partner_id
        and keep.badge_id = pb.badge_id
        and keep.period_key = pb.period_key
        and (coalesce(keep.earned_at, 'epoch'::timestamptz), keep.id)
          < (coalesce(pb.earned_at, 'epoch'::timestamptz), pb.id)
   );

update partner_badges set group_id = null
 where badge_id in (select id from badges where badge_type is distinct from 4);

-- Der alte Constraint deckt beide Faelle in einem Index ab und scheitert
-- damit an den NULL-group_ids. Ersatz: zwei partielle Unique-Indizes.
alter table partner_badges drop constraint if exists partner_badges_unique_period;

create unique index if not exists partner_badges_unique_global
  on partner_badges (partner_id, badge_id, period_key)
  where group_id is null;

create unique index if not exists partner_badges_unique_group
  on partner_badges (partner_id, badge_id, group_id, period_key)
  where group_id is not null;

-- ═══════════════════════════════════════════════════════════════
-- 1: Hilfsroutinen -- Wochen-, Monats-, Jahresschluessel
-- ═══════════════════════════════════════════════════════════════
-- Entsprechen mondayOf/weekKeyOf/monthKeyOf im Client.
-- STABLE, nicht IMMUTABLE: timestamptz::date haengt an der TimeZone
-- der Sitzung und ist damit per Definition nicht immutable.

create or replace function sql_week_key(p_date timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  -- Montag als Wochenstart. dow: Sonntag = 0 ... Samstag = 6.
  -- Montag muss 0 Tage zurueckgehen, Sonntag 6 -- das leistet (dow+6)%7.
  select to_char(
    p_date::date - ((extract(dow from p_date::date)::int + 6) % 7),
    'YYYY-MM-DD'
  )
$$;

create or replace function sql_month_key(p_date timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_date::date, 'YYYY-MM')
$$;

create or replace function sql_year_key(p_date timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_date::date, 'YYYY')
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2: Badge-Auswertung fuer einen Partner
-- ═══════════════════════════════════════════════════════════════
-- Liefert die verdienten Badges. Aendert selbst nichts an der DB.
-- Der Rueckgabetyp hat sich geaendert (badge_type kam dazu), deshalb
-- drop statt create or replace.
--
-- Statt hstore (nicht installiert) zwei parallele Arrays plus
-- array_position -- bei vier Kategorien und wenigen hundert Wochen ist
-- das schnell genug und spart eine Extension.

drop function if exists evaluate_badges(uuid);

create function evaluate_badges(p_partner_id uuid)
returns table (badge_id uuid, period_key text, badge_type integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now_week_key text;
  v_now_month_key text;
  v_total_points integer;
  v_dishwasher_count integer;
  v_has_anniversary boolean;
  v_tier4_month_count integer;
  v_custom_category_count integer;
  v_this_week_without_request integer;
  v_this_week_tag_count integer;
  v_all_time_tag_count integer;
  v_cat_tags text[];
  v_cat_points integer[];
  v_week_keys text[];
  v_week_points integer[];
  v_streak integer;
  v_week_cursor date;
  v_this_week_total integer;
  v_pause_weeks integer;
  v_had_earlier_activity boolean;
  v_is_comeback boolean;
  r_badge record;
begin
  v_now_week_key := sql_week_key(now());
  v_now_month_key := sql_month_key(now());

  -- Ein Durchlauf ueber partner_capped_entries fuer alle Skalarwerte.
  -- Die erste Fassung rief die Funktion achtmal auf -- bei jedem
  -- einzelnen Punkteintrag.
  --
  -- counts_for_badges filtert auf die punktstaerkste Gruppe des Tages
  -- (Migration 32). Bewusste Ausnahme: der Jahrestag fuer "Der Merker"
  -- zaehlt ungefiltert, siehe Migration 35.
  select
    coalesce(sum(pce.counted_points) filter (where pce.counts_for_badges), 0)::integer,
    count(*) filter (
      where pce.counts_for_badges
        and pce.category_name = 'Geschirrspüler aus-/einräumen')::integer,
    coalesce(bool_or(pce.category_name = 'Jahrestag / Geburtstag perfekt gemeistert'), false),
    count(*) filter (
      where pce.counts_for_badges
        and sql_month_key(pce.entry_at) = v_now_month_key
        and pce.cat_tier = 4)::integer,
    count(*) filter (
      where pce.counts_for_badges
        and not coalesce(pce.cat_is_global, true))::integer,
    count(*) filter (
      where pce.counts_for_badges
        and sql_week_key(pce.entry_at) = v_now_week_key
        and pce.unprompted)::integer,
    count(distinct pce.cat_tag) filter (
      where pce.counts_for_badges
        and sql_week_key(pce.entry_at) = v_now_week_key)::integer,
    count(distinct pce.cat_tag) filter (where pce.counts_for_badges)::integer
  into
    v_total_points, v_dishwasher_count, v_has_anniversary, v_tier4_month_count,
    v_custom_category_count, v_this_week_without_request, v_this_week_tag_count,
    v_all_time_tag_count
  from partner_capped_entries(p_partner_id) pce;

  -- Punkte je Kategorie
  select coalesce(array_agg(t.tag), '{}'::text[]), coalesce(array_agg(t.pts), '{}'::integer[])
  into v_cat_tags, v_cat_points
  from (
    select pce.cat_tag as tag, sum(pce.counted_points)::integer as pts
    from partner_capped_entries(p_partner_id) pce
    where pce.counts_for_badges and pce.cat_tag is not null
    group by pce.cat_tag
  ) t;

  -- Punkte je Woche
  select coalesce(array_agg(t.wk), '{}'::text[]), coalesce(array_agg(t.pts), '{}'::integer[])
  into v_week_keys, v_week_points
  from (
    select sql_week_key(pce.entry_at) as wk, sum(pce.counted_points)::integer as pts
    from partner_capped_entries(p_partner_id) pce
    where pce.counts_for_badges
    group by sql_week_key(pce.entry_at)
  ) t;

  -- ── Streak: Wochen in Folge mit mindestens 20 Punkten ────────────
  -- array_position liefert NULL fuer unbekannte Wochen, arr[NULL] ist
  -- NULL, coalesce macht 0 daraus. Ohne dieses coalesce war die
  -- Abbruchbedingung NULL und die Schleife lief endlos -- jeder
  -- Punkteintrag haette die Verbindung blockiert.
  v_streak := 0;
  v_week_cursor := v_now_week_key::date;
  loop
    exit when coalesce(
      v_week_points[array_position(v_week_keys, sql_week_key(v_week_cursor::timestamptz))], 0
    ) < 20;
    v_streak := v_streak + 1;
    v_week_cursor := v_week_cursor - 7;
    -- Harte Schranke: zehn Jahre. Reine Notbremse, fachlich unerreichbar.
    exit when v_streak > 520;
  end loop;

  -- ── Comeback: diese Woche >= 30 nach mindestens drei Nullwochen ──
  v_this_week_total := coalesce(v_week_points[array_position(v_week_keys, v_now_week_key)], 0);
  v_is_comeback := false;
  if v_this_week_total >= 30 then
    v_pause_weeks := 0;
    v_week_cursor := v_now_week_key::date - 7;
    loop
      exit when coalesce(
        v_week_points[array_position(v_week_keys, sql_week_key(v_week_cursor::timestamptz))], 0
      ) > 0;
      v_pause_weeks := v_pause_weeks + 1;
      v_week_cursor := v_week_cursor - 7;
      exit when v_pause_weeks > 52;
    end loop;
    select exists(
      select 1 from partner_capped_entries(p_partner_id) pce
       where pce.entry_at::date < v_week_cursor
    ) into v_had_earlier_activity;
    v_is_comeback := v_pause_weeks >= 3 and v_had_earlier_activity;
  end if;

  -- ── Katalog durchgehen ───────────────────────────────────────────
  -- Kein Filter auf is_hidden: die sechs versteckten Badges sind genau
  -- die mit den Ausloesern hellseher/allrounder/dishwasher_count/
  -- anniversary/tier4_month/custom_category_count. Die erste Fassung
  -- schloss sie aus und liess die zugehoerigen Zweige tot laufen.
  -- Saisontitel (badge_type 4) vergibt award_period_title() per Cron.
  --
  -- Der Trigger laeuft nur nach INSERT. Es wird deshalb nur geprueft,
  -- ob ein Badge verdient ist -- nie, ob er zu entziehen waere.
  for r_badge in
    select b.id, b.trigger_type, b.trigger_value, b.category_filter, b.badge_type
      from badges b
     where b.badge_type is distinct from 4
  loop
    if r_badge.trigger_type = 'total_points' then
      if v_total_points >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'category_points' then
      if coalesce(v_cat_points[array_position(v_cat_tags, r_badge.category_filter)], 0)
         >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'streak_weeks' then
      if v_streak >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'comeback' then
      if v_is_comeback then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    -- "Der Hellseher": 5x ohne Aufforderung in dieser Woche.
    -- Die erste Fassung pruefte hier den Jahrestag -- das ist "Der Merker".
    elsif r_badge.trigger_type = 'hellseher' then
      if v_this_week_without_request >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'dishwasher_count' then
      if v_dishwasher_count >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    -- "Der Allrounder": in EINER Woche in allen vier Kategorien gepunktet.
    -- Die erste Fassung zaehlte ueber die gesamte Zeit -- damit war der
    -- Badge nach vier beliebigen Eintraegen faellig.
    elsif r_badge.trigger_type = 'allrounder' then
      if v_this_week_tag_count >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'anniversary' then
      if v_has_anniversary then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'tier4_month' then
      if v_tier4_month_count >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;

    elsif r_badge.trigger_type = 'custom_category_count' then
      if v_custom_category_count >= r_badge.trigger_value then
        return query select r_badge.id, ''::text, r_badge.badge_type;
      end if;
    end if;
  end loop;
end;
$$;

-- Kein Zugriff fuer Clients: die Funktion nimmt eine beliebige
-- partner_id entgegen und wuerde sonst den Badge-Stand fremder Partner
-- preisgeben. CREATE FUNCTION vergibt EXECUTE per Vorgabe an PUBLIC --
-- "einfach nicht granten" reicht deshalb nicht, es braucht ein revoke.
revoke all on function evaluate_badges(uuid) from public;
revoke all on function evaluate_badges(uuid) from authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 3: Vergabe -- interne Funktion plus Trigger-Wrapper
-- ═══════════════════════════════════════════════════════════════
-- Getrennt, weil der Trigger die group_id fuer Saisontitel braucht und
-- die Logik ausserhalb des Triggers testbar bleiben soll (per SQL-Editor
-- als Eigentuemer, nicht als Client).

drop function if exists award_badges_for_partner(uuid);

create or replace function award_badges_for_partner(p_partner_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select * from evaluate_badges(p_partner_id) loop
    if r.badge_type = 4 then
      -- Saisontitel bleiben an die Gruppe gebunden.
      insert into partner_badges (partner_id, badge_id, group_id, period_key)
      values (p_partner_id, r.badge_id, p_group_id, coalesce(r.period_key, ''))
      on conflict (partner_id, badge_id, group_id, period_key)
        where group_id is not null
        do nothing;
    else
      -- Alle uebrigen Typen gelten fuer den Partner als Person.
      insert into partner_badges (partner_id, badge_id, group_id, period_key)
      values (p_partner_id, r.badge_id, null, coalesce(r.period_key, ''))
      on conflict (partner_id, badge_id, period_key)
        where group_id is null
        do nothing;
    end if;
  end loop;
end;
$$;

-- Ohne revoke koennte jede angemeldete Person fremden Partnern Badges
-- verleihen -- die Funktion prueft die Berechtigung bewusst nicht,
-- weil der Trigger sie mit geprueften Werten aufruft.
revoke all on function award_badges_for_partner(uuid, uuid) from public;
revoke all on function award_badges_for_partner(uuid, uuid) from authenticated;

-- Der Wrapper ist die eigentliche Triggerfunktion: kein Parameter,
-- returns trigger, Werte aus NEW.
create or replace function trg_award_badges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform award_badges_for_partner(NEW.partner_id, NEW.group_id);
  return NEW;
end;
$$;

-- Der Wrapper behaelt die Vorgabe-Rechte: ausserhalb eines Triggers
-- laesst er sich ohnehin nicht sinnvoll aufrufen, und Postgres prueft
-- EXECUTE nur beim Anlegen des Triggers, nicht beim Ausloesen.

-- AFTER INSERT, damit der ausloesende Eintrag bereits sichtbar ist und
-- apply_point_entry_rules (BEFORE INSERT, Migration 37) den endgueltigen
-- Punktwert schon gesetzt hat.
drop trigger if exists trg_award_badges_on_point_entry on point_entries;
create trigger trg_award_badges_on_point_entry
  after insert on point_entries
  for each row execute function trg_award_badges();

-- ═══════════════════════════════════════════════════════════════
-- 4: Direkte Client-Inserts auf partner_badges sperren
-- ═══════════════════════════════════════════════════════════════
-- Nicht ueber feste Policy-Namen: die erste Fassung droppte
-- "Nur eigene Partner in eigenen Gruppen" -- eine Policy, die es nie
-- gab. Der Aufruf lief per "if exists" still ins Leere, die reale
-- INSERT-Policy "Badges nur fuer eigene Partner" (Migration 25) blieb
-- stehen. Da PERMISSIVE-Policies mit ODER verknuepft werden, haette sie
-- die Sperre unten vollstaendig aufgehoben.
--
-- Deshalb: alles wegraeumen, was tatsaechlich da ist, und melden was.
do $$
declare
  r record;
begin
  for r in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'partner_badges'
       and cmd in ('INSERT', 'ALL')
  loop
    execute format('drop policy %I on partner_badges', r.policyname);
    raise notice 'partner_badges: INSERT-Policy % entfernt', r.policyname;
  end loop;
end;
$$;

-- Jetzt darf nur noch der Trigger schreiben. Er laeuft SECURITY DEFINER
-- als Eigentuemer der Tabelle und umgeht RLS damit ohnehin.
create policy "partner_badges_no_direct_insert"
  on partner_badges for insert
  with check (false);

-- UPDATE und DELETE haben auf partner_badges keine Policy und sind
-- damit bereits gesperrt (RLS ohne Policy verweigert). Bewusst so
-- gelassen: delete_account() raeumt als SECURITY DEFINER auf.

-- ═══════════════════════════════════════════════════════════════
-- 4b: award_period_title() an die neuen Indizes anpassen
-- ═══════════════════════════════════════════════════════════════
-- Die Funktion (Migration 18, laeuft per pg_cron) benutzt
-- "on conflict (partner_id, badge_id, group_id, period_key)". Diese
-- Kombination gibt es nach dem Umbau nur noch als partiellen Index --
-- ohne die WHERE-Klausel findet Postgres keinen passenden Index und
-- der naechste Cron-Lauf scheitert. Nur die ON-CONFLICT-Zeile aendert
-- sich, die Auswahllogik bleibt unveraendert.

create or replace function award_period_title(p_period text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_period_key text;
  v_badge_id uuid;
  v_trigger_type text;
  v_group record;
  v_winner record;
begin
  if p_period = 'week' then
    v_range_end := date_trunc('week', now());
    v_range_start := v_range_end - interval '7 days';
    v_period_key := to_char(v_range_start, 'IYYY-"W"IW');
    v_trigger_type := 'weekly_rank1';
  elsif p_period = 'month' then
    v_range_end := date_trunc('month', now());
    v_range_start := v_range_end - interval '1 month';
    v_period_key := to_char(v_range_start, 'YYYY-MM');
    v_trigger_type := 'monthly_rank1';
  elsif p_period = 'year' then
    v_range_end := date_trunc('year', now());
    v_range_start := v_range_end - interval '1 year';
    v_period_key := to_char(v_range_start, 'YYYY');
    v_trigger_type := 'yearly_rank1';
  else
    raise exception 'Unbekannter Zeitraum: %', p_period;
  end if;

  select id into v_badge_id from badges where trigger_type = v_trigger_type;
  if v_badge_id is null then
    raise exception 'Saisontitel-Badge fuer % nicht gefunden.', v_trigger_type;
  end if;

  -- Geloeschte Gruppen bekommen keinen Titel mehr.
  for v_group in select id from groups where deleted_at is null loop
    select pe.partner_id, sum(pe.points) as total
    into v_winner
    from point_entries pe
    join group_partner_memberships gpm
      on gpm.group_id = pe.group_id and gpm.partner_id = pe.partner_id and gpm.active = true
    where pe.group_id = v_group.id
      and pe.created_at >= v_range_start and pe.created_at < v_range_end
    group by pe.partner_id
    order by total desc
    limit 1;

    if v_winner.partner_id is not null and v_winner.total > 0 then
      insert into partner_badges (partner_id, badge_id, group_id, period_key)
      values (v_winner.partner_id, v_badge_id, v_group.id, v_period_key)
      on conflict (partner_id, badge_id, group_id, period_key)
        where group_id is not null
        do nothing;
    end if;
  end loop;
end;
$$;

revoke all on function award_period_title(text) from public;
revoke all on function award_period_title(text) from authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 5: group_category_overrides aufgeraeumt
-- ═══════════════════════════════════════════════════════════════
-- Tabelle, vier Policies, ein CHECK-Constraint. Von der App weder
-- gelesen noch geschrieben, seit die Punktwerte fest an die
-- Aufwandsstufe gebunden sind (Migration 16).
--
-- Die vier "drop policy"-Aufrufe der ersten Fassung nannten Namen, die
-- es nicht gibt (die realen stammen aus Migration 08 und 25). Folgenlos,
-- weil "drop table" die Policies mitnimmt -- aber es sind vier Zeilen,
-- die still nichts tun. Ersatzlos gestrichen, "drop table" genuegt.

drop table if exists group_category_overrides;

-- ═══════════════════════════════════════════════════════════════
-- Kontrollqueries nach dem Ausfuehren
-- ═══════════════════════════════════════════════════════════════
-- -- 1. Es darf genau eine INSERT-Policy geben, und die muss sperren:
-- select policyname, cmd, with_check from pg_policies
--  where tablename = 'partner_badges';
--
-- -- 2. Beide partiellen Indizes muessen stehen:
-- select indexname, indexdef from pg_indexes
--  where tablename = 'partner_badges';
--
-- -- 3. Der Trigger muss haengen:
-- select tgname from pg_trigger
--  where tgrelid = 'point_entries'::regclass and not tgisinternal;
--
-- -- 4. Keine Client-Rechte auf den Vergabe-Funktionen:
-- select proname, proacl from pg_proc
--  where proname in ('evaluate_badges', 'award_badges_for_partner', 'award_period_title');
--
-- -- 5. Probelauf ohne Schreiben (als Eigentuemer im SQL-Editor):
-- select * from evaluate_badges((select id from partners limit 1));

-- ═══════════════════════════════════════════════════════════════
-- Offene Entscheidungen
-- ═══════════════════════════════════════════════════════════════
-- 1) Wiederholbare Badges: "Die Serie", "Marathonmann", "Ironman" und
--    "Comeback des Jahres" stehen in Migration 19 auf
--    is_repeatable = true, bekommen hier aber period_key = '' und sind
--    damit einmalig. Fuer echte Wiederholbarkeit muesste der period_key
--    den Zeitraum tragen, in dem der Streak zustande kam -- dann ist zu
--    klaeren, ob 24 Wochen Serie einmal "Ironman" gibt oder in jeder
--    weiteren Woche erneut.
--
-- 2) Wochengrenze: sql_week_key() rechnet in der Zeitzone des Servers
--    (UTC), partner_capped_entries() in der des Geraets (Migration 26).
--    Zwischen 00:00 und 02:00 Ortszeit am Montag koennen Streak-Wochen
--    und Tagesdeckel deshalb auseinanderlaufen. Fuer den Testlauf
--    hingenommen; sauber waere, die Zeitzone durchzureichen.
--
-- 3) Der Punktestand hinter einem Badge kann sinken: partner_badges
--    bleibt bestehen, die Summe aus point_entries nicht. Loescht eine
--    Nutzerin einen Eintrag ueber delete_point_entry(), zeigt die
--    Badge-Ansicht weniger Punkte an, als der Badge verlangt. Bewusst
--    so -- ein verdienter Erfolg wird nicht wieder entzogen.
