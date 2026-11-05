import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type ThemePalette } from '../../theme/ThemeContext';
import type { GoerMessage } from '../../goer/types';
import { MessageBubble } from './MessageBubble';
import { QuickReplies } from './QuickReplies';
import { HandoffDivider } from './AgentBadge';
import { ServerProductCards } from './ServerProductCards';
import { MenuItemCards } from './MenuItemCards';
import { CartSummaryCard } from './CartSummaryCard';
import { OrderStatusCard } from './OrderStatusCard';
import { OrderConfirmationCard } from './OrderConfirmationCard';

/** Renders one transcript entry — text bubble or rich widget. Memoized because
 *  it feeds an inverted FlatList that re-renders on every streamed token. */
export const MessageView = memo(function MessageView({ message }: { message: GoerMessage }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  switch (message.kind) {
    case 'text':
      return <MessageBubble role={message.role} text={message.text} />;
    case 'quick_replies':
      return <QuickReplies options={message.options} />;
    case 'agent_handoff':
      return <HandoffDivider from={message.from} to={message.to} />;
    case 'menu_items':
      return <MenuItemCards itemIDs={message.itemIDs} />;
    case 'server_products':
      return <ServerProductCards items={message.items} />;
    case 'cart_summary':
      return <CartSummaryCard snapshot={message.snapshot} />;
    case 'order_status':
      return <OrderStatusCard info={message.info} />;
    case 'order_confirmation':
      return <OrderConfirmationCard stagedOrderID={message.stagedOrderID} />;
    case 'system_note':
      return (
        <View style={styles.noteRow}>
          <Text style={styles.noteText}>{message.text}</Text>
        </View>
      );
    // Rich widgets (menu cards, cart summary, checkout, tracking) are wired in
    // as they land; unknown kinds render nothing rather than crashing.
    default:
      return null;
  }
});

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    noteRow: { alignItems: 'center', marginVertical: 8, paddingHorizontal: 16 },
    noteText: { fontSize: 12, color: colors.textLight, textAlign: 'center' },
  });
