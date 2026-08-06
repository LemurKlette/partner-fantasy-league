import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BadgeFrame, { frameColors, iconSizeFor, type BadgeTier } from './BadgeFrame';
import { COLORS, type CategoryKey } from '../theme/colors';
import { iconFor } from '../theme/icons';

// Einzige Badge-Darstellung der App. Kein Badge wird irgendwo von Hand
// nachgebaut — nur so bleiben Groesse, Rahmenform und Ausgrauung ueberall
// identisch.

export type BadgeProps = {
  name: string;
  iconKey?: string | null;
  imageUrl?: string | null;
  tier?: BadgeTier;
  category?: CategoryKey | null;
  earned: boolean;
  /** Wie oft verdient. > 1 zeigt den Zaehler-Punkt. */
  count?: number;
  /** Versteckte Badges werden nur gerendert, wenn verdient. */
  isHidden?: boolean;
  /** Aktueller Wert fuer den Fortschrittsbalken (Stufe 1/2). */
  progressCurrent?: number | null;
  /** Zielwert fuer den Fortschrittsbalken. */
  progressTarget?: number | null;
  size?: number;
  /** Hintergrundfarbe des umgebenden Screens — fuer den Rand des Zaehlers. */
  surroundingColor?: string;
  /** Breite der Kachel. Fuer Rasterlayouts z.B. '31%'. */
  width?: number | string;
  /** Oeffnet die Erklaerung zum Badge. */
  onPress?: () => void;
};

export default function Badge({
  name,
  iconKey,
  imageUrl,
  tier = null,
  category = null,
  earned,
  count = 0,
  isHidden = false,
  progressCurrent = null,
  progressTarget = null,
  size = 62,
  surroundingColor = COLORS.surface,
  width,
  onPress,
}: BadgeProps) {
  // Versteckte Badges vor dem Verdienen gar nicht rendern — auch nicht ausgegraut.
  if (isHidden && !earned) return null;

  const locked = !earned;
  const { icon: iconColor } = frameColors(category, locked);
  const iconSize = iconSizeFor(tier, size);

  const showProgress =
    !earned && progressCurrent != null && progressTarget != null && progressTarget > 0;

  const Container: any = onPress ? TouchableOpacity : View;

  return (
    <Container
      style={[s.wrapper, { width: (width ?? size + 28) as any }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ width: size, height: size }}>
        <BadgeFrame tier={tier} category={category} locked={locked} size={size} />

        {/* Icon ODER Bild — beide in derselben Komponente, damit Groesse,
            Kreisform und Ausgrauung identisch bleiben. */}
        <View style={[s.inner, { width: size, height: size }]}>
          {imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={{
                width: iconSize,
                height: iconSize,
                borderRadius: iconSize / 2,
                opacity: locked ? 0.4 : 1,
              }}
            />
          ) : (
            <MaterialCommunityIcons
              name={iconFor(iconKey) as any}
              size={iconSize}
              color={iconColor}
              style={locked ? s.lockedIcon : undefined}
            />
          )}
        </View>

        {count > 1 && (
          <View style={[s.counter, { borderColor: surroundingColor }]}>
            <Text style={s.counterText}>×{count}</Text>
          </View>
        )}
      </View>

      {/* Im Info-Modal wird der Name separat als Ueberschrift gesetzt und
          hier leer gelassen -- dann keine leere Textzeile rendern. */}
      {name.length > 0 && (
        <Text style={[s.name, locked && s.nameLocked]} numberOfLines={2}>
          {name}
        </Text>
      )}

      {showProgress && (
        <>
          <View style={s.progressTrack}>
            <View
              style={[
                s.progressFill,
                { width: `${Math.min(100, (progressCurrent! / progressTarget!) * 100)}%` },
              ]}
            />
          </View>
          <Text style={s.progressText}>
            {Math.min(progressCurrent!, progressTarget!)} / {progressTarget}
          </Text>
        </>
      )}
    </Container>
  );
}

const s = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: 4 },
  inner: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  lockedIcon: { opacity: 0.4 },
  counter: {
    position: 'absolute',
    right: -6,
    bottom: -2,
    backgroundColor: COLORS.terracotta,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  counterText: { color: COLORS.onTerracotta, fontSize: 10, fontWeight: 'bold' },
  name: { fontSize: 11, fontWeight: '600', textAlign: 'center', color: COLORS.ink },
  nameLocked: { color: COLORS.inkMuted },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: COLORS.sandDeep,
    borderRadius: 2,
    marginTop: 2,
  },
  progressFill: { height: 4, backgroundColor: COLORS.gold, borderRadius: 2 },
  progressText: { fontSize: 9, color: COLORS.inkMuted },
});
