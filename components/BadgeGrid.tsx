import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import Badge from './Badge';
import type { BadgeTier } from './BadgeFrame';
import { CATEGORY_TAG_TO_KEY, COLORS, type CategoryKey } from '../theme/colors';

type BadgeRow = {
  id: string;
  name: string;
  icon_key: string | null;
  image_url: string | null;
  badge_type: number;
  tier: number | null;
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

export default function BadgeGrid({
  partnerId,
  surroundingColor = COLORS.sand,
}: {
  partnerId: string;
  surroundingColor?: string;
}) {
  const [badges, setBadges] = useState<BadgeDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => { load(); }, [partnerId]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    // Punktesummen kommen ueber eine RPC statt direkt aus point_entries:
    // Maenner sind nicht in group_members und duerfen die Tabelle deshalb
    // nicht lesen -- ausserdem bleiben so die Notizen der Frauen privat.
    const [{ data: allBadges, error: e1 }, { data: earnedRows, error: e2 }, { data: totals, error: e3 }] = await Promise.all([
      supabase.from('badges')
        .select('id, name, icon_key, image_url, badge_type, tier, trigger_type, trigger_value, category_filter, is_hidden')
        .order('sort_order'),
      supabase.from('partner_badges').select('badge_id').eq('partner_id', partnerId),
      supabase.rpc('partner_point_totals', { p_partner_id: partnerId }),
    ]);

    // Ohne diese Pruefung wuerden alle Badges als gesperrt mit 0 Fortschritt
    // erscheinen -- optisch nicht von "noch nichts verdient" zu unterscheiden.
    const err = e1 ?? e2 ?? e3;
    if (err) {
      setLoadError(err.message);
      setBadges([]);
      setLoading(false);
      return;
    }

    const catTotals: Record<string, number> = {};
    let totalPoints = 0;
    ((totals ?? []) as any[]).forEach(r => {
      totalPoints += r.total;
      if (r.category_tag) catTotals[r.category_tag] = (catTotals[r.category_tag] || 0) + r.total;
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
      // Versteckte Badges nur zeigen, wenn bereits verdient
      .filter(b => !b.is_hidden || b.earned);

    setBadges(display);
    setLoading(false);
  }

  if (loading) return <ActivityIndicator color={COLORS.terracotta} style={{ marginVertical: 20 }} />;

  if (loadError) {
    return (
      <View style={s.errorBox}>
        <Text style={s.errorTitle}>Badges konnten nicht geladen werden</Text>
        <Text style={s.errorText}>{loadError}</Text>
      </View>
    );
  }

  const grouped: Record<number, BadgeDisplay[]> = {};
  badges.forEach(b => { (grouped[b.badge_type] ??= []).push(b); });

  return (
    <View style={{ gap: 20 }}>
      {[1, 2, 3, 4, 5].filter(t => grouped[t]?.length).map(type => (
        <View key={type} style={{ gap: 10 }}>
          <Text style={s.groupLabel}>{TYPE_LABELS[type]}</Text>
          <View style={s.grid}>
            {grouped[type].map(b => (
              <Badge
                key={b.id}
                name={b.name}
                iconKey={b.icon_key}
                imageUrl={b.image_url}
                tier={(b.tier as BadgeTier) ?? null}
                category={
                  b.category_filter
                    ? (CATEGORY_TAG_TO_KEY[b.category_filter] as CategoryKey) ?? null
                    : null
                }
                earned={b.earned}
                count={b.count}
                isHidden={b.is_hidden}
                progressCurrent={b.progressCurrent}
                progressTarget={b.trigger_value}
                surroundingColor={surroundingColor}
              />
            ))}
          </View>
        </View>
      ))}
      {badges.length === 0 && <Text style={{ color: COLORS.inkMuted }}>Noch keine Badges verfügbar.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  errorBox: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.terracotta,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  errorTitle: { fontSize: 14, fontWeight: '600', color: COLORS.terracotta },
  errorText: { fontSize: 13, color: COLORS.inkSoft },
});
