import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius } from '../theme/theme';
import { useTheme, type ThemePalette } from '../theme/ThemeContext';
import { DisplayText } from './DisplayText';
import { RemoteImage } from './RemoteImage';
import { GradientButton } from './GradientButton';
import type { CartLineSelection, MenuItem, MenuOptionGroup } from '../types';

interface Props {
  visible: boolean;
  item: MenuItem | null;
  onClose: () => void;
  onAddToCart: (selections: CartLineSelection[], notes: string, quantity: number) => void;
}

/** groupId -> selected choice ids, in selection order. */
type SelectionState = Record<string, string[]>;

/** Item customization sheet — mirrors the real ordering flow: required/optional
 *  option groups (radio for single-select, capped checkboxes for multi-select),
 *  a free-text preferences note, a quantity stepper, and a live-priced CTA. */
export function ItemOptionsSheet({ visible, item, onClose, onAddToCart }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const groups = item?.optionGroups ?? [];
  const [selected, setSelected] = useState<SelectionState>({});
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);

  // Reset the form whenever a new item is opened.
  useEffect(() => {
    if (visible && item) {
      setSelected({});
      setNotes('');
      setQuantity(1);
    }
  }, [visible, item?.id]);

  if (!item) return null;

  const toggleChoice = (group: MenuOptionGroup, choiceId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? [];
      if (group.maxSelect <= 1) {
        // Radio behaviour: required groups always keep exactly one choice
        // selected; optional single-choice groups can be toggled off.
        const next = current[0] === choiceId && !group.required ? [] : [choiceId];
        return { ...prev, [group.id]: next };
      }
      if (current.includes(choiceId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== choiceId) };
      }
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, choiceId] };
    });
  };

  const unsatisfiedRequired = groups.filter(
    (g) => g.required && (selected[g.id]?.length ?? 0) === 0,
  );
  const canAdd = unsatisfiedRequired.length === 0;

  const optionsTotal = groups.reduce((sum, g) => {
    const ids = selected[g.id] ?? [];
    return sum + g.choices.filter((c) => ids.includes(c.id)).reduce((s, c) => s + c.priceDelta, 0);
  }, 0);
  const unitPrice = item.price + optionsTotal;
  const total = unitPrice * quantity;

  const handleAdd = () => {
    if (!canAdd) return;
    const selections: CartLineSelection[] = groups
      .map((g) => {
        const ids = selected[g.id] ?? [];
        const choices = g.choices.filter((c) => ids.includes(c.id));
        if (choices.length === 0) return null;
        return {
          groupId: g.id,
          groupTitle: g.title,
          choiceNames: choices.map((c) => c.name),
          priceDelta: choices.reduce((s, c) => s + c.priceDelta, 0),
        };
      })
      .filter((s): s is CartLineSelection => s !== null);
    onAddToCart(selections, notes.trim(), quantity);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Stop taps inside the sheet from dismissing it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <View>
                <RemoteImage
                  urlString={item.imageURL}
                  fallbackIcon={item.icon}
                  style={styles.hero}
                  iconSize={44}
                />
                <Pressable
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={20} color={colors.navy} />
                </Pressable>
              </View>

              <View style={styles.headerBlock}>
                <DisplayText size={30} weight="bold" color={colors.navy}>
                  {item.name}
                </DisplayText>
                {item.itemDescription ? (
                  <Text style={styles.description}>{item.itemDescription}</Text>
                ) : null}
                <Text style={styles.basePrice}>${item.price.toFixed(2)}</Text>
              </View>

              {groups.map((group) => {
                const ids = selected[group.id] ?? [];
                const atCap = ids.length >= group.maxSelect;
                return (
                  <View key={group.id} style={styles.groupBlock}>
                    <View style={styles.groupHeaderRow}>
                      <Text style={styles.groupTitle}>{group.title}</Text>
                      {group.required ? (
                        <View style={styles.requiredPill}>
                          <Text style={styles.requiredPillText}>Required</Text>
                        </View>
                      ) : group.maxSelect > 1 ? (
                        <Text style={styles.groupSub}>Select up to {group.maxSelect}</Text>
                      ) : null}
                    </View>
                    <View style={styles.choiceList}>
                      {group.choices.map((choice) => {
                        const isSelected = ids.includes(choice.id);
                        const disabled = !isSelected && group.maxSelect > 1 && atCap;
                        return (
                          <Pressable
                            key={choice.id}
                            onPress={() => toggleChoice(group, choice.id)}
                            disabled={disabled}
                            hitSlop={4}
                            accessibilityRole={group.maxSelect <= 1 ? 'radio' : 'checkbox'}
                            accessibilityState={{ selected: isSelected, disabled }}
                            accessibilityLabel={choice.name}
                            style={[styles.choiceRow, disabled && styles.choiceRowDisabled]}
                          >
                            <Ionicons
                              name={
                                group.maxSelect <= 1
                                  ? isSelected
                                    ? 'radio-button-on'
                                    : 'radio-button-off'
                                  : isSelected
                                    ? 'checkbox'
                                    : 'square-outline'
                              }
                              size={20}
                              color={isSelected ? colors.orange : colors.gray400}
                            />
                            <Text
                              style={[styles.choiceName, disabled && styles.choiceNameDisabled]}
                            >
                              {choice.name}
                            </Text>
                            {choice.priceDelta > 0 ? (
                              <Text style={styles.choiceDelta}>
                                +${choice.priceDelta.toFixed(2)}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}

              {item.allowsNotes ? (
                <View style={styles.groupBlock}>
                  <Text style={styles.groupTitle}>Preferences</Text>
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Add a note for the kitchen (optional)"
                    placeholderTextColor={colors.gray400}
                    multiline
                    style={styles.notesInput}
                  />
                </View>
              ) : null}

              <View style={styles.qtyBlock}>
                <Text style={styles.groupTitle}>Quantity</Text>
                <View style={styles.qtyControl}>
                  <Pressable
                    onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease quantity"
                  >
                    <Ionicons name="remove-circle" size={30} color={colors.orange} />
                  </Pressable>
                  <Text style={styles.qtyText}>{quantity}</Text>
                  <Pressable
                    onPress={() => setQuantity((q) => q + 1)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Increase quantity"
                  >
                    <Ionicons name="add-circle" size={30} color={colors.orange} />
                  </Pressable>
                </View>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              {!canAdd ? (
                <Text style={styles.footerWarning}>
                  Required: {unsatisfiedRequired.map((g) => g.title).join(', ')}
                </Text>
              ) : null}
              <GradientButton
                title={`Add to cart • $${total.toFixed(2)}`}
                onPress={handleAdd}
                disabled={!canAdd}
              />
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      maxHeight: '88%',
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      backgroundColor: colors.white,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      overflow: 'hidden',
    },
    hero: { height: 220, width: '100%' },
    closeButton: {
      position: 'absolute',
      top: 16,
      right: 16,
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerBlock: { paddingHorizontal: 24, paddingTop: 24, gap: 8 },
    description: { fontSize: 14, color: colors.textLight, lineHeight: 22 },
    basePrice: { fontSize: 18, fontWeight: '700', color: colors.navy, marginTop: 4 },
    groupBlock: { paddingHorizontal: 24, paddingTop: 28, gap: 12 },
    groupHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    groupTitle: { fontSize: 15, fontWeight: '700', color: colors.navy },
    groupSub: { fontSize: 12, color: colors.textLight },
    requiredPill: {
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.sm,
    },
    requiredPillText: { fontSize: 11, fontWeight: '700', color: colors.accentInk },
    choiceList: { gap: 2 },
    choiceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 16,
      minHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.gray200,
    },
    choiceRowDisabled: { opacity: 0.4 },
    choiceName: { flex: 1, fontSize: 14.5, color: colors.navy },
    choiceNameDisabled: { color: colors.textLight },
    choiceDelta: { fontSize: 13, fontWeight: '600', color: colors.textLight },
    notesInput: {
      minHeight: 64,
      borderWidth: 1,
      borderColor: colors.gray200,
      borderRadius: radius.md,
      padding: 12,
      fontSize: 14,
      color: colors.navy,
      textAlignVertical: 'top',
    },
    qtyBlock: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8, gap: 14 },
    qtyControl: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    qtyText: {
      fontSize: 17,
      fontWeight: '700',
      minWidth: 24,
      textAlign: 'center',
      color: colors.navy,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 24,
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: colors.gray200,
      backgroundColor: colors.white,
    },
    footerWarning: { fontSize: 12.5, color: colors.danger, textAlign: 'center' },
  });
