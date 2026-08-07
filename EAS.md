# Builds mit EAS

Kurzanleitung für Testbuilds und später den Store. Die Profile stehen in `eas.json`.

## Einmalig einrichten

```bash
npm install -g eas-cli        # oder jedem Aufruf npx voranstellen
eas login                     # fragt nach dem Expo-Konto
eas init                      # legt die projectId in app.json an
```

`eas login` und `eas init` sind interaktiv — im Claude-Code-Chat mit `!` davor ausführen,
damit die Ausgabe im Gespräch landet.

## Umgebungsvariablen — der häufigste Stolperstein

`.env` steht in `.gitignore`, und **EAS lädt nur Dateien hoch, die in Git liegen.** Ohne
weiteres Zutun hätte der Build also keine Supabase-Zugangsdaten: die App startet, findet
`EXPO_PUBLIC_SUPABASE_URL` als `undefined` und scheitert beim ersten Aufruf.

Deshalb die beiden Werte einmal bei EAS hinterlegen:

```bash
eas env:create --scope project --environment preview \
  --name EXPO_PUBLIC_SUPABASE_URL --value "https://DEINPROJEKT.supabase.co" --visibility plaintext

eas env:create --scope project --environment preview \
  --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value "eyJ..." --visibility plaintext
```

Für den Store-Build dasselbe noch einmal mit `--environment production`.

`plaintext` ist hier richtig und kein Versehen: alles mit `EXPO_PUBLIC_`-Präfix wird beim
Bauen fest in das App-Bundle geschrieben und lässt sich aus jeder installierten App wieder
auslesen. Der Publishable Key ist genau dafür gemacht — geschützt wird nicht er, sondern die
Daten dahinter, durch die RLS-Policies.

**Nicht bei EAS hinterlegen:** `SUPABASE_ACCESS_TOKEN` und `SUPABASE_PROJECT_REF` aus deiner
`.env`. Das sind echte Geheimnisse für die Management-API und im Build nichts verloren.

Kontrolle:

```bash
eas env:list --environment preview
```

## Testbuild für Android (der übliche Weg)

```bash
eas build --platform android --profile preview
```

Ergebnis ist eine **APK** mit interner Verteilung. EAS gibt am Ende einen Link mit QR-Code
aus — den an die Tester schicken, sie laden die Datei direkt aufs Handy und installieren sie.
Kein Play Store, kein Konto, keine Freischaltung nötig. Android fragt einmal nach der
Erlaubnis, Apps aus unbekannter Quelle zu installieren.

Dauer: meist 10–20 Minuten in der Warteschlange des kostenlosen Kontingents.

## iOS

Deutlich aufwendiger als Android:

- **Auf echten iPhones** braucht es ein Apple Developer Program für 99 $/Jahr. Die Geräte
  müssen einzeln registriert werden (`eas device:create`), danach `eas build --platform ios
  --profile preview` mit `"simulator": false`.
- **Im Simulator** geht es ohne Konto — das Profil `preview` ist dafür bereits auf
  `"simulator": true` gestellt. Nützlich zum Selbsttesten auf einem Mac, für Tester ohne Mac
  aber wertlos.

Für den ersten Testlauf: iOS-Nutzer über **Expo Go** testen lassen (`npx expo start`,
QR-Code scannen), Android-Nutzer über die APK.

## Store-Build (später)

```bash
eas build --platform android --profile production
eas submit --platform android --latest
```

`appVersionSource: "remote"` in `eas.json` bedeutet, dass EAS die Versionsnummer verwaltet und
bei jedem Production-Build hochzählt — du musst in `app.json` nichts anfassen.

## Achtung: Paketkennung ist endgültig

`app.json` trägt jetzt `com.powercouples.app` als `android.package` und
`ios.bundleIdentifier`. **Bis zum ersten Store-Upload frei änderbar, danach nicht mehr** — eine
Änderung wäre dann eine komplett neue App ohne die bestehenden Installationen und Bewertungen.
Wenn dir eine andere Kennung lieber ist, jetzt ändern.

## Profile in eas.json

| Profil | Zweck | Ergebnis |
|---|---|---|
| `development` | Entwickeln mit eigenem Dev-Client statt Expo Go | APK, intern |
| `preview` | **Testlauf mit anderen** | APK (Android), Simulator-Build (iOS) |
| `production` | Store-Veröffentlichung | AAB, Version zählt automatisch hoch |

Das Profil `development` setzt `expo-dev-client` voraus. Falls du es nutzen willst:

```bash
npx expo install expo-dev-client
```

Für den Testlauf ist es nicht nötig.
