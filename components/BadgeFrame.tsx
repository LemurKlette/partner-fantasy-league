import Svg, { Circle, Polygon } from 'react-native-svg';
import { CATEGORY_COLORS, COLORS, type CategoryKey } from '../theme/colors';

// Die Stufe eines Badges wird durch die Rahmenform ausgedrueckt, nicht durch
// Farbe: 5 Zacken = Stufe 1, 7 Zacken = Stufe 2, 9 Zacken = Stufe 3,
// Kreis = keine Stufe.
//
// Polygone sind Konstanten und werden NICHT bei jedem Render neu berechnet.
// Alle Koordinaten beziehen sich auf viewBox "0 0 60 60".

const STAR_5 =
  '30,2 36.6,20.9 56.6,21.3 40.6,33.5 46.5,52.6 30,41.2 13.5,52.6 ' +
  '19.4,33.5 3.4,21.3 23.4,20.9';

const STAR_7 =
  '30,2 36.5,16.5 51.9,12.5 44.6,26.7 57.3,36.2 41.7,39.4 42.1,55.2 ' +
  '30,45 17.9,55.2 18.3,39.4 2.7,36.2 15.4,26.7 8.1,12.5 23.5,16.5';

const STAR_9 =
  '30,2 36,13.6 48,8.6 45.2,21.3 57.6,25.1 47.2,33 54.2,44 41.3,43.4 ' +
  '39.6,56.3 30,47.5 20.4,56.3 18.7,43.4 5.8,44 12.8,33 2.4,25.1 ' +
  '14.8,21.3 12,8.6 24,13.6';

const STAR_BY_TIER: Record<1 | 2 | 3, string> = {
  1: STAR_5,
  2: STAR_7,
  3: STAR_9,
};

export type BadgeTier = 1 | 2 | 3 | null;

export type BadgeFrameProps = {
  tier: BadgeTier;
  category: CategoryKey | null;
  locked: boolean;
  size?: number;
};

// Farben eines Rahmens. Gesperrte Badges bekommen eine eigene Fuell- und
// Strichfarbe — Ausgrauung laeuft nie allein ueber Opazitaet, die wirkt auf
// verschiedenen Untergruenden unterschiedlich.
export function frameColors(category: CategoryKey | null, locked: boolean) {
  if (locked) {
    return { fill: COLORS.disabled, stroke: COLORS.inkMuted, icon: COLORS.disabledInk };
  }
  const c = category ? CATEGORY_COLORS[category] : CATEGORY_COLORS.household;
  return { fill: c.fill, stroke: c.stroke, icon: c.stroke };
}

export default function BadgeFrame({ tier, category, locked, size = 46 }: BadgeFrameProps) {
  const { fill, stroke } = frameColors(category, locked);
  const points = tier ? STAR_BY_TIER[tier] : null;

  return (
    <Svg width={size} height={size} viewBox="0 0 60 60" opacity={locked ? 0.4 : 1}>
      {points ? (
        <Polygon points={points} fill={fill} stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      ) : (
        <Circle cx={30} cy={30} r={27} fill={fill} stroke={stroke} strokeWidth={1.5} />
      )}
    </Svg>
  );
}
