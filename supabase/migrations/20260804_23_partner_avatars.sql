-- Migration: Partner-Profilbilder
-- Datum: 2026-08-05

alter table partners add column if not exists avatar_url text;

-- Storage-Bucket fuer Avatare (oeffentlich lesbar, damit Bilder direkt per
-- Public-URL angezeigt werden koennen, ohne signierte URLs zu verwalten)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Jede Datei liegt unter "<partner_id>/<dateiname>" im Bucket. Nur die
-- Besitzerin des jeweiligen Partners darf Dateien in diesem Ordner
-- hochladen/aendern/loeschen. Lesen ist oeffentlich (Bucket ist public).
create policy "Oeffentlicher Lesezugriff auf Partner-Avatare"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Partner-Eigentuemerin laedt Avatar hoch"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = any(array(select get_my_partner_ids()))
  );

create policy "Partner-Eigentuemerin aktualisiert Avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = any(array(select get_my_partner_ids()))
  );

create policy "Partner-Eigentuemerin loescht Avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1]::uuid = any(array(select get_my_partner_ids()))
  );
