import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../src/theme/theme';
import { useTheme, type ThemePalette } from '../src/theme/ThemeContext';
import { DisplayText } from '../src/components/DisplayText';
import { GradientButton } from '../src/components/GradientButton';
import { usePaymentStore } from '../src/store/paymentStore';
import {
  detectBrand,
  formatCardNumber,
  formatExpiry,
  validateCard,
  type CardBrand,
} from '../src/lib/cardBrand';

export default function PaymentScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cards = usePaymentStore((s) => s.cards);
  const addCard = usePaymentStore((s) => s.addCard);
  const setDefault = usePaymentStore((s) => s.setDefault);
  const remove = usePaymentStore((s) => s.remove);

  const [adding, setAdding] = useState(cards.length === 0);
  const [cardholder, setCardholder] = useState('');
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [error, setError] = useState<string | null>(null);

  const brand: CardBrand = detectBrand(number.replace(/\D/g, ''));

  if (!__DEV__) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <DisplayText size={30} weight="bold" color={colors.navy}>
            Payment Methods
          </DisplayText>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="close" size={26} color={colors.navy} />
          </Pressable>
        </View>
        <Text style={{ padding: 16, color: colors.navy }}>
          Payments are currently unavailable. No card details can be saved or charged.
        </Text>
      </SafeAreaView>
    );
  }

  const onSave = async () => {
    const check = validateCard({ number, expiry, cvv, cardholder });
    if (!check.valid) {
      setError(check.error ?? 'Please check your card details.');
      return;
    }
    await addCard({ number, expiry, cardholder });
    setCardholder('');
    setNumber('');
    setExpiry('');
    setCvv('');
    setError(null);
    setAdding(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <DisplayText size={30} weight="bold" color={colors.navy}>
          Payment Methods
        </DisplayText>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="close" size={26} color={colors.navy} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {cards.map((card) => (
            <Pressable key={card.id} style={styles.cardRow} onPress={() => setDefault(card.id)}>
              <View style={styles.brandChip}>
                <Ionicons name="card" size={20} color={colors.onBrand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardBrand}>
                  {card.brand} •••• {card.last4}
                </Text>
                <Text style={styles.cardMeta}>
                  {card.cardholder} · exp {card.expMonth}/{card.expYear}
                </Text>
              </View>
              {card.isDefault ? (
                <View style={styles.defaultPill}>
                  <Text style={styles.defaultPillText}>Default</Text>
                </View>
              ) : null}
              <Pressable onPress={() => remove(card.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={colors.gray400} />
              </Pressable>
            </Pressable>
          ))}

          {adding ? (
            <View style={styles.form}>
              {/* Card preview */}
              <View style={styles.preview}>
                <View style={styles.previewTop}>
                  <Ionicons name="card" size={26} color={colors.onBrand} />
                  <Text style={styles.previewBrand}>{brand}</Text>
                </View>
                <Text style={styles.previewNumber}>
                  {formatCardNumber(number) || '•••• •••• •••• ••••'}
                </Text>
                <View style={styles.previewBottom}>
                  <Text style={styles.previewName}>
                    {cardholder.toUpperCase() || 'CARDHOLDER NAME'}
                  </Text>
                  <Text style={styles.previewExp}>{expiry || 'MM/YY'}</Text>
                </View>
              </View>

              <TextInput
                placeholder="Cardholder name"
                placeholderTextColor={colors.gray400}
                value={cardholder}
                onChangeText={(t) => {
                  setCardholder(t);
                  if (error) setError(null);
                }}
                autoCapitalize="words"
                style={styles.input}
              />
              <TextInput
                placeholder="Card number"
                placeholderTextColor={colors.gray400}
                value={formatCardNumber(number)}
                onChangeText={(t) => {
                  setNumber(t);
                  if (error) setError(null);
                }}
                keyboardType="number-pad"
                style={styles.input}
              />
              <View style={styles.inlineRow}>
                <TextInput
                  placeholder="MM/YY"
                  placeholderTextColor={colors.gray400}
                  value={expiry}
                  onChangeText={(t) => {
                    setExpiry(formatExpiry(t));
                    if (error) setError(null);
                  }}
                  keyboardType="number-pad"
                  style={[styles.input, { flex: 1 }]}
                />
                <TextInput
                  placeholder="CVV"
                  placeholderTextColor={colors.gray400}
                  value={cvv}
                  onChangeText={(t) => {
                    setCvv(t.replace(/\D/g, '').slice(0, 4));
                    if (error) setError(null);
                  }}
                  keyboardType="number-pad"
                  secureTextEntry
                  style={[styles.input, { flex: 1 }]}
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.secureNote}>
                <Ionicons name="lock-closed" size={13} color={colors.textLight} />
                <Text style={styles.secureText}>
                  Demo only — we store just the brand and last 4 digits on your device.
                </Text>
              </View>

              <GradientButton title="Save Card" onPress={onSave} style={{ marginTop: 4 }} />
            </View>
          ) : (
            <Pressable style={styles.addButton} onPress={() => setAdding(true)}>
              <Ionicons name="add" size={20} color={colors.orange} />
              <Text style={styles.addButtonText}>Add a new card</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      backgroundColor: colors.offWhite,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingVertical: 20,
    },
    cardRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 20,
    },
    brandChip: {
      width: 42,
      height: 30,
      borderRadius: 6,
      backgroundColor: colors.navyMid,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardBrand: { fontSize: 15, fontWeight: '700', color: colors.navy },
    cardMeta: { fontSize: 12, color: colors.textLight, marginTop: 2 },
    defaultPill: {
      backgroundColor: colors.orange,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
    },
    defaultPillText: { color: colors.onBrand, fontSize: 11, fontWeight: '700' },
    form: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 20,
      gap: 16,
      marginTop: 8,
    },
    preview: {
      backgroundColor: colors.brandNavy,
      borderRadius: radius.lg,
      padding: 24,
      gap: 24,
      justifyContent: 'space-between',
      minHeight: 180,
    },
    previewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewBrand: { color: colors.onBrand, fontSize: 15, fontWeight: '700' },
    previewNumber: { color: colors.onBrand, fontSize: 20, letterSpacing: 2, fontWeight: '600' },
    previewBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    previewName: { color: colors.onBrandMuted, fontSize: 12, fontWeight: '600' },
    previewExp: { color: colors.onBrandMuted, fontSize: 12, fontWeight: '600' },
    input: {
      minWidth: 0,
      backgroundColor: colors.offWhite,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 16,
      minHeight: 54,
      fontSize: 15,
      color: colors.navy,
    },
    inlineRow: { flexDirection: 'row', gap: 12 },
    error: { color: colors.danger, fontSize: 13 },
    secureNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    secureText: { flex: 1, fontSize: 11.5, color: colors.textLight, lineHeight: 16 },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.white,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      minHeight: 56,
      paddingVertical: 16,
    },
    addButtonText: { fontSize: 15, fontWeight: '600', color: colors.orange },
  });
