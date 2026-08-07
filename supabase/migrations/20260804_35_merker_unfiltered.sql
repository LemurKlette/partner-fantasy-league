-- Migration: Einmal-Badges unabhaengig von der Gruppenauswahl ermoeglichen
-- Datum: 2026-08-07
--
-- Seit Migration 32 zaehlen fuer Badges nur die Eintraege der Gruppe, in der
-- der Partner an dem Tag am meisten gesammelt hat. Fuer wiederholbare Zaehler
-- ist das richtig -- sonst wuerde dieselbe erledigte Aufgabe mehrfach zaehlen.
--
-- Fuer "Der Merker" ist es aber falsch: Das Badge gibt es genau einmal fuers
-- Denken an einen Jahrestag oder Geburtstag. Stand dieser Eintrag zufaellig in
-- einer Gruppe, die an dem Tag nicht die punktstaerkste war, fiel er heraus
-- und das Badge kam nie -- obwohl der Partner es verdient hatte. Bei einem
-- einmaligen Badge kann Mehrfacheintragung ohnehin nichts aufblaehen.
--
-- Loesung: Die Funktion liefert jetzt ALLE Eintraege und markiert ueber
-- counts_for_badges, welche in die Wertung eingehen. Zaehler-Badges nutzen
-- weiterhin nur die markierten, Einmal-Badges duerfen alle sehen.

-- Die Spalte counts_for_badges kommt neu dazu. Postgres erlaubt es nicht,
-- den Rueckgabetyp per "create or replace" zu aendern, deshalb vorher
-- verwerfen. partner_point_totals() ruft diese Funktion zwar auf, haengt
-- aber nicht als Abhaengigkeit daran (Funktionskoerper werden nicht
-- aufgeloest) -- der Aufruf funktioniert nach dem Neuanlegen unveraendert.
drop function if exists partner_capped_entries(uuid);

create function partner_capped_entries(p_partner_id uuid)
returns table (
  counted_points integer,
  entry_at timestamptz,
  unprompted boolean,
  category_name text,
  cat_tag text,
  cat_tier integer,
  cat_is_global boolean,
  counts_for_badges boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  if not (
    p_partner_id = any(array(select get_my_partner_ids()))
    or p_partner_id = any(array(select get_my_connected_partner_ids()))
    or exists (
      select 1 from group_partner_memberships gpm
      where gpm.partner_id = p_partner_id
        and gpm.group_id = any(array(select get_my_group_ids()))
    )
  ) then
    raise exception 'Kein Zugriff auf diesen Partner.';
  end if;

  select p2.timezone into v_tz
  from partners pa
  left join profiles p2 on p2.user_id = pa.owner_user_id
  where pa.id = p_partner_id;
  if v_tz is null or not exists (select 1 from pg_timezone_names where name = v_tz) then
    v_tz := 'Europe/Berlin';
  end if;

  return query
  with daily as (
    select
      pe.group_id as gid,
      (pe.created_at at time zone v_tz)::date as lday,
      sum(pe.points) as day_points
    from point_entries pe
    where pe.partner_id = p_partner_id
    group by 1, 2
  ),
  best as (
    -- Pro Tag die Gruppe mit der hoechsten Summe. Bei Gleichstand
    -- entscheidet die group_id, damit das Ergebnis stabil bleibt.
    select distinct on (d.lday) d.lday, d.gid
    from daily d
    order by d.lday, d.day_points desc, d.gid
  ),
  ordered as (
    select
      pe.points as pts,
      pe.created_at as ts,
      pe.without_request as wr,
      pc.name as cname,
      pc.category_tag as ctag,
      pc.tier as ctier,
      pc.is_global as cglobal,
      (b.gid is not null) as in_best,
      -- Laufende Tagessumme, aber nur ueber die Eintraege der besten Gruppe.
      -- Eintraege anderer Gruppen tragen 0 bei und verschieben den Deckel
      -- damit nicht.
      sum(case when b.gid is not null then pe.points else 0 end) over (
        partition by (pe.created_at at time zone v_tz)::date
        order by pe.created_at, pe.id
        rows between unbounded preceding and current row
      ) as running_best
    from point_entries pe
    join point_categories pc on pc.id = pe.category_id
    -- LEFT JOIN statt INNER: Eintraege anderer Gruppen bleiben in der
    -- Ergebnismenge, tragen aber 0 Punkte bei.
    left join best b
      on b.lday = (pe.created_at at time zone v_tz)::date
     and b.gid = pe.group_id
    where pe.partner_id = p_partner_id
  )
  select
    case when o.in_best
         then greatest(0, least(o.pts, 80 - (o.running_best - o.pts)))
         else 0 end::integer,
    o.ts, o.wr, o.cname, o.ctag, o.ctier, o.cglobal, o.in_best
  from ordered o;
end;
$$;

grant execute on function partner_capped_entries(uuid) to authenticated;

-- partner_point_totals() summiert counted_points und bleibt damit korrekt:
-- Eintraege ausserhalb der besten Gruppe steuern 0 bei.
