import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';

type BadgeRow = {
  id: string;
  name: string;
  icon: string;
  badge_type: number;
  trigger_type: string;
  trigger_value: number | null;
  category_filter: string | null;
  is_hidden: boolean;
};

type BadgeDisplay = BadgeRow & { earned: boolean; count: number; progressCurrent: number | null };

const TYPE_LABELS: Record<number, string> = {
  1: 'Meilensteine',
  2: 'Kategorie-Spezialisten',
  3: 'Konsistenz',
  4: 'Saisontitel',
  5: 'Geheime Erfolge',
};

export default function BadgeGrid({ partnerId }: { partnerId: string }) {
  const [badges, setBadges] = useState<BadgeDisplay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [partnerId]);

  async function load() {
    setLoading(true);
    const [{ data: allBadges }, { data: earnedRows }, { data: entries }] = await Promise.all([
      supabase.from('badges').select('id, name, icon, badge_type, trigger_type, trigger_value, category_filter, is_hidden').order('sort_order'),
      supabase.from('partner_badges').select('badge_id').eq('partner_id', partnerId),
      supabase.from('point_entries').select('points, point_categories(category_tag)').eq('partner_id', partnerId),
    ]);

    const totalPoints = (entries ?? []).reduce((sum: number, e: any) => sum + e.points, 0);
    const catTotals: Record<string, number> = {};
    (entries ?? []).forEach((e: any) => {
      const tag = (e.point_categories as any)?.category_tag;
      if (tag) catTotals[tag] = (catTotals[tag] || 0) + e.points;
    });
    const countByBadge: Record<string, number> = {};
    (earnedRows ?? []).forEach((r: any) => { countByBadge[r.badge_id] = (countByBadge[r.badge_id] || 0) + 1; });

    const display = ((allBadges ?? []) as BadgeRow[])
      .map(b => {
        const count = countByBadge[b.id] || 0;
        let progressCurrent: number | null = null;
        if (b.trigger_type === 'total_points') progressCurrent = totalPoints;
        if (b.trigger_type === 'category_points' && b.category_filter) progressCurrent = catTotals[b.category_filter] || 0;
        return { ...b, earned: count > 0, count, progressCurrent };
      })
      // Versteckte Badges (Typ 5) nur zeigen, wenn bereits verdient
      .filter(b => !b.is_hidden || b.earned);

    setBadges(display);
    setLoading(false);
  }

  if (loading) return <ActivityIndicator color="#3ECF8E" style={{ marginVertical: 20 }} />;

  const grouped: Record<number, BadgeDisplay[]> = {};
  badges.forEach(b => { (grouped[b.badge_type] ??= []).push(b); });

  return (
    <View style={{ gap: 20 }}>
      {[1, 2, 3, 4, 5].filter(t => grouped[t]?.length).map(type => (
        <View key={type} style={{ gap: 10 }}>
          <Text style={s.groupLabel}>{TYPE_LABELS[type]}</Text>
          <View style={s.grid}>
            {grouped[type].map(b => (
              <View key={b.id} style={s.tile}>
                <View>
                  <Text style={[s.icon, !b.earned && s.iconMuted]}>{b.icon}</Text>
                  {b.count > 1 && (
                    <View style={s.countBubble}><Text style={s.countText}>×{b.count}</Text></View>
                  )}
                </View>
                <Text style={s.name} numberOfLines={2}>{b.name}</Text>
                {b.progressCurrent !== null && b.trigger_value != null && (
                  <>
                    <View style={s.progressTrack}>
                      <View style={[s.progressFill, { width: `${Math.min(100, (b.progressCurrent / b.trigger_value) * 100)}%` }]} />
                    </View>
                    <Text style={s.progressText}>{Math.min(b.progressCurrent, b.trigger_value)} / {b.trigger_value}</Text>
                  </>
                )}
              </View>
            ))}
          </View>
        </View>
      ))}
      {badges.length === 0 && <Text style={{ color: '#aaa' }}>Noch keine Badges verfügbar.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  groupLabel: { fontSize: 12, fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '30%', backgroundColor: '#fff', borderRadius: 12, padding: 10, alignItems: 'center', gap: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  icon: { fontSize: 28 },
  iconMuted: { opacity: 0.25 },
  name: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  countBubble: { position: 'absolute', right: -8, bottom: -4, backgroundColor: '#3ECF8E', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1 },
  countText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  progressTrack: { width: '100%', height: 4, backgroundColor: '#eee', borderRadius: 2, marginTop: 2 },
  progressFill: { height: 4, backgroundColor: '#3ECF8E', borderRadius: 2 },
  progressText: { fontSize: 9, color: '#aaa' },
});
