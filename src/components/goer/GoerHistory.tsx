import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/theme';
import { restoreAuthenticatedConversation } from '../../goer/authenticatedClient';
import { goerOwnerGeneration, useGoerStore } from '../../goer/goerStore';
import { HISTORY_PAGE_SIZE, listHistory, type HistoryConversation } from '../../goer/history';

export function GoerHistory({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const email = useGoerStore(s => s.ownerEmail);
  const pending = useGoerStore(s => s.pendingMessage);
  const generation = goerOwnerGeneration();
  const mounted = useRef(true);
  const [rows, setRows] = useState<HistoryConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');
  const current = () => mounted.current && generation === goerOwnerGeneration();

  async function fetchPage(offset: number) {
    if (!email) return;
    setLoading(true); setError('');
    try {
      const page = await listHistory(email, offset);
      if (!current()) return;
      setRows(previous => offset ? [...previous, ...page] : page);
      setMore(page.length === HISTORY_PAGE_SIZE);
    } catch {
      if (current()) setError('History is unavailable. Check your connection, sign-in and database setup.');
    } finally { if (current()) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void fetchPage(0);
    return () => { mounted.current = false; };
  }, [email, generation]);

  async function choose(id: string) {
    setLoading(true); setError('');
    try {
      await restoreAuthenticatedConversation(id);
      if (current()) onClose();
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : 'Could not open this conversation.');
    } finally { if (current()) setLoading(false); }
  }

  return <View style={{ flex: 1, padding: 16, gap: 12 }}>
    <Pressable accessibilityRole="button" onPress={onClose}>
      <Text style={{ color: colors.orange }}>Back to chat</Text>
    </Pressable>
    <Text style={{ color: colors.navy }}>Saved conversations</Text>
    {pending ? <Text style={{ color: colors.textLight }}>Retry your pending turn before switching conversations.</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.navy }}>{error}</Text> : null}
    {loading ? <ActivityIndicator accessibilityLabel="Loading saved history" color={colors.orange} /> : null}
    <FlatList data={rows} keyExtractor={row => row.id} renderItem={({ item }) =>
      <Pressable accessibilityRole="button" disabled={loading || Boolean(pending)}
        onPress={() => { void choose(item.id); }}
        style={{ padding: 12, marginBottom: 8, backgroundColor: colors.white, borderRadius: radius.md }}>
        <Text style={{ color: colors.navy }}>{item.title}</Text>
        <Text style={{ color: colors.textLight }}>{new Date(item.updated_at).toLocaleDateString()}</Text>
      </Pressable>}
      ListEmptyComponent={!loading && !error ? <Text style={{ color: colors.textLight }}>No saved conversations yet.</Text> : null}
      ListFooterComponent={more && !loading ? <Pressable accessibilityRole="button" onPress={() => { void fetchPage(rows.length); }}>
        <Text style={{ color: colors.orange }}>{error ? 'Retry loading history' : 'Load more conversations'}</Text>
      </Pressable> : null} />
  </View>;
}
