import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme/colors';

export default function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.sandDeep }}
      />
    );
  }

  return (
    <View
      style={[
        s.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: COLORS.terracottaLight },
      ]}
    >
      <Text style={{ color: COLORS.onTerracotta, fontWeight: 'bold', fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
