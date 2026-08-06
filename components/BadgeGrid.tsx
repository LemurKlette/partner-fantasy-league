import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import Badge from './Badge';
import type { BadgeTier } from './BadgeFrame';
import { CATEGORY_COLORS, CATEGORY_TAG_TO_KEY, COLORS, type CategoryKey } from '../theme/colors';

type BadgeRow = {
  id: string;
  name: string;
  description: string | null;
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
  5: 'Geheime Badges',
};

// Reihenfolge der Kategorien innerhalb der Spezialisten-Badges
const CATEGORY_ORDER: CategoryKey[] = ['household', 'mentalLoad', 'romance', 'reliability'];
const CATEGORY_LABELS: Record<string, string> = {
  household: 'Haushalt',
  mentalLoad: 'Mental Load',
  romance: 'Romantik & Aufmerksamkeit',
  reliability: 'Verlässlichkeit & Partnerschaft',
};

function categoryOf(b: BadgeRow): CategoryKey | null {
  if (!b.category_filter) return null;
  return (CATEGORY_TAG_TO_KEY[b.category_filter] as CategoryKey) ?? null;
}

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
  const [selected, setSelected] = useState<BadgeDisplay | null>(null);

  useEffect(() => { load(); }, [partnerId]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    // Punktesummen kommen ueber eine RPC statt direkt aus point_entries:
    // Maenner sind nicht in group_members und duerfen die Tabelle deshalb
    // nicht lesen -- ausserdem bleiben so die Notizen der Frauen privat.
    const [{ data: allBadges, error: e1 }, { data: earnedRows, error: e2 }, { data: totals, error: e3 }] = await Promise.all([
      supabase.from('badges')
        .select('id, name, description, icon_key, image_url, badge_type, tier, trigger_type, trigger_value, category_filter, is_hidden')
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

  const renderBadge = (b: BadgeDisplay) => (
    <Badge
      key={b.id}
      name={b.name}
      iconKey={b.icon_key}
      imageUrl={b.image_url}
      tier={(b.tier as BadgeTier) ?? null}
      category={categoryOf(b)}
      earned={b.earned}
      count={b.count}
      isHidden={b.is_hidden}
      progressCurrent={b.progressCurrent}
      progressTarget={b.trigger_value}
      surroundingColor={surroundingColor}
      width="31%"
      onPress={() => setSelected(b)}
    />
  );

  // Reihenfolge: erst die Spezialisten nach Kategorie gruppiert, danach die
  // kategorielosen Typen, ganz unten die geheimen Badges.
  const specialists = grouped[2] ?? [];

  return (
    <View style={{ gap: 20 }}>
      {specialists.length > 0 && (
        <View>
          <Text style={s.groupLabel}>{TYPE_LABELS[2]}</Text>
          {CATEGORY_ORDER.map(key => {
            const list = specialists.filter(b => categoryOf(b) === key);
            if (list.length === 0) return null;
            return (
              <View key={key}>
                <Text style={[s.categoryHeader, { color: CATEGORY_COLORS[key].stroke }]}>
                  {CATEGORY_LABELS[key] ?? key}
                </Text>
                <View style={s.grid}>{list.map(renderBadge)}</View>
              </View>
            );
          })}
        </View>
      )}

      {/* Meilensteine, Konsistenz und Saisontitel haben keine Kategorie und
          bleiben deshalb in einem einfachen Raster. */}
      {[1, 3, 4].filter(t => grouped[t]?.length).map(type => (
        <View key={type} style={{ gap: 10 }}>
          <Text style={s.groupLabel}>{TYPE_LABELS[type]}</Text>
          <View style={s.grid}>{grouped[type].map(renderBadge)}</View>
        </View>
      ))}

      {(grouped[5]?.length ?? 0) > 0 && (
        <View style={{ gap: 10 }}>
          <Text style={s.groupLabel}>{TYPE_LABELS[5]}</Text>
          <View style={s.grid}>{grouped[5].map(renderBadge)}</View>
        </View>
      )}

      {badges.length === 0 && <Text style={{ color: COLORS.inkMuted }}>Noch keine Badges verfügbar.</Text>}

      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        {/* Antippen ausserhalb der Karte schliesst das Modal. */}
        <Pressable style={s.backdrop} onPress={() => setSelected(null)}>
          {selected && (
            <Pressable style={s.modalCard} onPress={() => {}}>
              <Badge
                name=""
                iconKey={selected.icon_key}
                imageUrl={selected.image_url}
                tier={(selected.tier as BadgeTier) ?? null}
                category={categoryOf(selected)}
                earned={selected.earned}
                count={selected.count}
                size={72}
                surroundingColor={COLORS.surface}
                width={100}
              />
              <Text style={s.modalTitle}>{selected.name}</Text>
              <Text style={s.modalText}>{selected.description ?? 'Keine Beschreibung hinterlegt.'}</Text>
              {selected.count > 1 && (
                <Text style={s.modalMeta}>{selected.count}× erhalten</Text>
              )}
              {!selected.earned && selected.progressCurrent != null && selected.trigger_value != null && (
                <Text style={s.modalMeta}>
                  Fortschritt: {Math.min(selected.progressCurrent, selected.trigger_value)} / {selected.trigger_value}
                </Text>
              )}
              <TouchableOpacity style={s.modalBtn} onPress={() => setSelected(null)}>
                <Text style={s.modalBtnText}>Zurück</Text>
              </TouchableOpacity>
            </Pressable>
          )}
        </Pressable>
      </Modal>
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
  // 3 Kacheln pro Zeile: 3 × 31 % plus zweimal columnGap passen auch auf
  // schmale Geraete, ohne dass die dritte Kachel umbricht.
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 14 },
  categoryHeader: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 8 },
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

  backdrop: {
    flex: 1,
    backgroundColor: COLORS.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    alignSelf: 'stretch',
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: COLORS.ink, textAlign: 'center' },
  modalText: { fontSize: 14, color: COLORS.inkSoft, textAlign: 'center', lineHeight: 20 },
  modalMeta: { fontSize: 12, color: COLORS.inkMuted, textAlign: 'center' },
  modalBtn: {
    marginTop: 12,
    backgroundColor: COLORS.terracotta,
    borderRadius: 8,
    paddingVertical: 12,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  modalBtnText: { color: COLORS.onTerracotta, fontWeight: 'bold', fontSize: 16 },
});
