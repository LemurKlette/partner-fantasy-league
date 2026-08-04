import { Image, StyleSheet, Text, View } from 'react-native';

const AVATAR_COLORS = ['#3ECF8E', '#F59E0B', '#EF4444', '#8B5CF6', '#3B82F6', '#EC4899', '#14B8A6', '#F97316'];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function Avatar({ uri, name, size = 44 }: { uri?: string | null; name: string; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#eee' }}
      />
    );
  }

  return (
    <View style={[s.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: colorForName(name) }]}>
      <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
