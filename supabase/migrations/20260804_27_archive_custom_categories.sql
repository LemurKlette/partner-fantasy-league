-- Migration: Eigene Kategorien archivieren statt hart loeschen
-- Datum: 2026-08-06
--
-- Problem: point_entries.category_id verweist ohne "on delete" auf
-- point_categories. Sobald fuer eine eigene Kategorie schon Punkte
-- vergeben wurden, scheiterte das Loeschen an einer Fremdschluessel-
-- verletzung -- obwohl der Bestaetigungsdialog "Vergangene Eintraege
-- bleiben erhalten" verspricht.
--
-- Loesung: unbenutzte Kategorien werden weiterhin hart geloescht,
-- benutzte bekommen archived_at gesetzt. Damit verschwinden sie aus
-- allen Auswahllisten, die Historie im Aktivitaetslog behaelt aber
-- ihren Namen und ihr Icon.

alter table point_categories add column if not exists archived_at timestamptz;

create or replace function delete_custom_category(p_category_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat point_categories%rowtype;
  v_used boolean;
begin
  select * into v_cat from point_categories where id = p_category_id;

  if not found then
    raise exception 'Kategorie nicht gefunden.';
  end if;
  if v_cat.is_global then
    raise exception 'Standard-Aufgaben können nicht gelöscht werden.';
  end if;
  if v_cat.group_id is null
     or not (v_cat.group_id = any(array(select get_my_group_ids()))) then
    raise exception 'Kein Zugriff auf diese Kategorie.';
  end if;

  select exists (select 1 from point_entries where category_id = p_category_id)
    into v_used;

  if v_used then
    update point_categories set archived_at = now() where id = p_category_id;
    return 'archived';
  else
    delete from point_categories where id = p_category_id;
    return 'deleted';
  end if;
end;
$$;

grant execute on function delete_custom_category(uuid) to authenticated;
