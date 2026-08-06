// Einzige Farbquelle der App.
// Regel: Ausserhalb dieser Datei steht NIRGENDWO ein Hex-Wert.

export const COLORS = {
  // Flächen
  sand:        '#F1EFE8',  // Grundfläche aller Screens
  sandDeep:    '#E8E3D6',  // Header, Trennflächen, leere Fortschrittsbalken
  surface:     '#FFFFFF',  // Karten, Listenzeilen

  // Aktionen — NIEMALS als Kategoriefarbe verwenden
  terracotta:      '#993C1D',  // Primärbutton, aktiver Tab, Zähler-Punkt
  terracottaLight: '#D85A30',  // Avatar-Hintergrund
  onTerracotta:    '#FAECE7',  // Text/Icon auf Terrakotta

  // Text
  ink:      '#2C2C2A',
  inkSoft:  '#5F5E5A',
  inkMuted: '#888780',

  // Ranking
  gold: '#BA7517',  // Platz 1, Fortschrittsbalken

  // Gesperrte Badges
  disabled:    '#D3D1C7',
  disabledInk: '#444441',

  // Abdunklung hinter Modalen
  scrim: 'rgba(0, 0, 0, 0.5)',
} as const;

// Kategoriefarben. Haushalt ist Ocker, NICHT Terrakotta — Terrakotta bleibt
// ausschliesslich Aktionsfarbe, sonst bedeutet dieselbe Farbe gleichzeitig
// "hier kannst du tippen" und "das ist Haushalt".
export const CATEGORY_COLORS = {
  household:   { stroke: '#854F0B', fill: '#FAEEDA' },  // Ocker
  mentalLoad:  { stroke: '#3B6D11', fill: '#EAF3DE' },  // Olivgrün
  romance:     { stroke: '#993556', fill: '#FBEAF0' },  // Beere
  reliability: { stroke: '#0F6E56', fill: '#E1F5EE' },  // Petrol
  // Selbst erstellte Kategorien. Neutrales Grau, deutlich abgesetzt von den
  // vier Standard-Kategorien — signalisiert "keine Standard-Aufgabe".
  custom:      { stroke: '#6B6B6B', fill: '#F0F0F0' },  // Grau
} as const;

export type CategoryKey = keyof typeof CATEGORY_COLORS;

// Verbindung zu den category_tag-Werten in der Datenbank
export const CATEGORY_TAG_TO_KEY: Record<string, CategoryKey> = {
  haushalt:         'household',
  mental_load:      'mentalLoad',
  romantik:         'romance',
  verlaesslichkeit: 'reliability',
};
