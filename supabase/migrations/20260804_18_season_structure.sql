-- Migration: Saisonstruktur (Spielwoche / Monat / Saison)
-- Datum: 2026-08-05
--
-- Die Woche/Monat/Jahr-Tabs im Dashboard sind bereits kalenderbasiert
-- (siehe App.tsx getStartDate: Woche = Montag-Sonntag, Monat = Kalendermonat,
-- Jahr = Kalenderjahr). Ein Punkte-"Reset" zum 1. Januar passiert dadurch
-- automatisch, weil die Jahresansicht nur Eintraege ab dem 1.1. summiert --
-- es muss nichts geloescht werden, alte Eintraege bleiben fuer die Historie
-- erhalten.
--
-- Diese Migration ergaenzt die Vergabe von Saisontiteln (Typ 4, siehe auch
-- Schritt 4) als wiederholbare Badges: "Spieler der Woche", "Monatssieger",
-- "Saisonsieger [Jahr]".
--
-- WICHTIG: Fuer die automatische woechentliche/monatliche/jaehrliche Vergabe
-- wird die Postgres-Extension "pg_cron" benoetigt. Falls "create extension"
-- unten fehlschlaegt (fehlende Rechte), aktiviere pg_cron zuerst manuell im
-- Supabase Dashboard unter Database -> Extensions -> pg_cron, und fuehre
-- danach den Rest dieses Skripts erneut aus.

-- 1. Schema-Erweiterung fuer wiederholbare/typisierte Badges
--    (wird in Schritt 4 fuer die restlichen Badge-Typen weiterverwendet)
alter table badges add column if not exists badge_type integer;
alter table badges add column if not exists is_hidden boolean not null default false;
alter table badges add column if not exists is_repeatable boolean not null default false;
alter table badges alter column trigger_value drop not null;

alter table partner_badges add column if not exists period_key text;

alter table partner_badges drop constraint if exists partner_badges_partner_id_badge_id_group_id_key;
alter table partner_badges
  add constraint partner_badges_unique_period unique (partner_id, badge_id, group_id, period_key);

-- 2. Die drei Saisontitel als Typ-4-Badges anlegen (falls noch nicht vorhanden)
insert into badges (name, description, icon, trigger_type, trigger_value, badge_type, is_repeatable)
select * from (values
  ('Spieler der Woche', 'Platz 1 der Wochenwertung in dieser Gruppe', '🏆', 'weekly_rank1', null::integer, 4, true),
  ('Monatssieger', 'Platz 1 der Monatswertung in dieser Gruppe', '🥇', 'monthly_rank1', null::integer, 4, true),
  ('Saisonsieger', 'Platz 1 zum Jahresende in dieser Gruppe', '👑', 'yearly_rank1', null::integer, 4, true)
) as v(name, description, icon, trigger_type, trigger_value, badge_type, is_repeatable)
where not exists (select 1 from badges where badges.trigger_type = v.trigger_type);

-- 3. Funktion: ermittelt fuer jede Gruppe den/die Erstplatzierte des zuletzt
--    abgeschlossenen Zeitraums und vergibt den passenden Saisontitel
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

  for v_group in select id from groups loop
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
      on conflict (partner_id, badge_id, group_id, period_key) do nothing;
    end if;
  end loop;
end;
$$;

-- 4. Automatischer Zeitplan via pg_cron (Zeiten in UTC)
create extension if not exists pg_cron;

select cron.schedule('award-weekly-title', '5 0 * * 1', $$select award_period_title('week')$$)
where not exists (select 1 from cron.job where jobname = 'award-weekly-title');

select cron.schedule('award-monthly-title', '5 0 1 * *', $$select award_period_title('month')$$)
where not exists (select 1 from cron.job where jobname = 'award-monthly-title');

select cron.schedule('award-yearly-title', '5 0 1 1 *', $$select award_period_title('year')$$)
where not exists (select 1 from cron.job where jobname = 'award-yearly-title');
