# Partner Fantasy League – Fortschritt

## 2026-08-04 – Projekt-Setup
- Expo (React Native) Projekt mit TypeScript erstellt (`blank-typescript` Template)
- SDK auf 54 hochgestuft (react 19.1.0, react-native 0.81.5)
- Supabase Client installiert (`@supabase/supabase-js`)
- `.env` mit `EXPO_PUBLIC_SUPABASE_URL` und `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` eingerichtet
- `lib/supabase.ts` als zentraler Client angelegt
- Supabase-Tabellen: –

## 2026-08-04 – Auth (Login / Registrierung)
- Login- und Registrierungs-Screen mit E-Mail & Passwort in `App.tsx`
- Nach Login: Platzhalter-Screen mit E-Mail und Logout-Button
- Supabase Auth: `signInWithPassword`, `signUp`, `signOut`
- Supabase-Tabellen: `auth.users` (von Supabase verwaltet)

## 2026-08-04 – Partner anlegen
- Screen "Partner anlegen" erscheint nach Login, falls noch kein Partner vorhanden
- Partner-Name wird gespeichert und auf dem Home-Screen angezeigt
- Supabase-Tabellen: `partners` (id, owner_user_id, name, created_at)
- RLS: Nutzer sieht und erstellt nur eigene Partner

## 2026-08-04 – Gruppe erstellen
- Screen "Gruppe erstellen" erscheint nach Partner-Screen
- Zufälliger 6-stelliger Einladungscode wird beim Erstellen generiert
- Ersteller wird automatisch als Mitglied eingetragen
- Home-Screen zeigt Gruppenname, Einladungscode und Partner-Name
- Supabase-Tabellen: `groups` (id, name, created_by, invite_code, created_at), `group_members` (group_id, user_id, joined_at)
- RLS: Mitglieder sehen nur ihre eigene Gruppe
