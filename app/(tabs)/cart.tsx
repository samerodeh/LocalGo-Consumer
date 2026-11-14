import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useTheme } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { GradientButton } from '../../src/components/GradientButton';
import { RemoteImage } from '../../src/components/RemoteImage';
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { Badge } from '../../src/components/ui/Badge';
import { QuantityStepper } from '../../src/components/ui/QuantityStepper';
import { TipSelector } from '../../src/components/cart/TipSelector';
import { useCartStore } from '../../src/store/cartStore';
import { useCommerceStore } from '../../src/store/commerceStore';
import { useCartQuote } from '../../src/store/useCartQuote';
import { useAddressStore } from '../../src/store/addressStore';
import { useAuthStore } from '../../src/store/authStore';
import { cartLineUnitPrice } from '../../src/lib/cartLine';
import { placeOrder } from '../../src/lib/placeOrder';
import { deliveryLocationProblem, isValidDeliveryLocation } from '../../src/lib/deliveryLocation';
import { quoteCart } from '../../src/lib/consumerApi';
import { restaurantById } from '../../src/data/restaurants';
import type { DeliveryPreference } from '../../src/types';

export default function CartScreen() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const lines = useCartStore((s) => s.lines);
  const increment = useCartStore((s) => s.incrementLine);
  const decrement = useCartStore((s) => s.decrementLine);
  const subtotal = useCartStore((s) => s.subtotal());
  const fee = useCartStore((s) => s.deliveryFee());
  const rid = useCartStore((s) => s.restaurantID);
  const { mode, setMode, merchants, ready, refresh } = useCommerceStore();
  const merchant = merchants.find((m) => m.id === rid);
  const restaurant = merchant ?? restaurantById(rid ?? '');
  const address = useAddressStore((s) => s.defaultAddress);
  const saveAddress = useAddressStore((s) => s.save);
  const user = useAuthStore((s) => s.currentUser);
  const [percent, setPercent] = useState<number | null>(18);
  const [custom, setCustom] = useState('');
  const [promo, setPromo] = useState<string | null>(null);
  const [promoDraft, setPromoDraft] = useState('');
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const processingLock = useRef(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [preference, setPreference] = useState<DeliveryPreference>('Leave at door');
  const [instructions, setInstructions] = useState('');
  const [instructionBusy, setInstructionBusy] = useState(false);
  const [instructionError, setInstructionError] = useState('');
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const tip =
    mode === 'pickup'
      ? 0
      : percent === null
        ? Math.max(0, Math.round((Number.parseFloat(custom) || 0) * 100))
        : Math.round(subtotal * percent);
  const quoted = useCartQuote(lines, rid, mode, tip, promo, ready);
  const server = quoted.quote;
  const total = server
    ? server.totalCents / 100
    : subtotal + (mode === 'pickup' ? 0 : fee) + tip / 100;
  const key = useRef<{ signature: string; id: string } | null>(null);
  const signature = JSON.stringify({
    quote: quoted.signature,
    addressId: address?.id,
    addressUpdated: address?.updatedAt,
  });
  if (key.current?.signature !== signature) key.current = { signature, id: Crypto.randomUUID() };
  const startCheckout = () => {
    setError('');
    if (mode === 'delivery' && !isValidDeliveryLocation(address)) {
      Alert.alert(
        'Delivery address needed',
        deliveryLocationProblem(address) ?? 'Please add a delivery address.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add address', onPress: () => router.push('/address') },
        ],
      );
      return;
    }
    setConfirm(false);
    setDrawer(true);
  };
  const submit = async () => {
    if (processingLock.current || !lines.length || (ready && !server)) return;
    processingLock.current = true;
    setProcessing(true);
    setError('');
    try {
      const result = await placeOrder({
        lines,
        subtotal,
        deliveryFee: server ? server.deliveryFeeCents / 100 : mode === 'pickup' ? 0 : fee,
        tip: tip / 100,
        total,
        restaurantID: rid,
        deliveryAddress: address,
        customer: user,
        mode,
        quote: server ?? undefined,
        checkoutId: key.current?.id,
      });
      if (result.ok) {
        setDrawer(false);
        router.replace({
          pathname: '/order-confirmed',
          params: {
            mode: result.mode ?? mode,
            orderId: result.orderId ?? '',
            eta: merchant ? `${merchant.etaMin}–${merchant.etaMax} min` : '',
          },
        });
      } else {
        setError(result.error);
        setConfirm(false);
        quoted.refresh();
      }
    } finally {
      processingLock.current = false;
      setProcessing(false);
    }
  };
  const summary = (
    <View style={{ gap: 14 }}>
      {[
        ['Food subtotal', server ? server.subtotalCents / 100 : subtotal],
        ['Delivery', server ? server.deliveryFeeCents / 100 : mode === 'pickup' ? 0 : fee],
        ...(mode === 'delivery' ? [['Courier tip', tip / 100]] : []),
        ...(server?.discountCents ? [['Promotion', -server.discountCents / 100]] : []),
      ].map(([label, value]) => (
        <View key={String(label)} style={styles.summaryRow}>
          <Text style={{ fontSize: 14, color: c.textLight }}>{label}</Text>
          <Text style={{ fontSize: 14, color: c.navy, fontWeight: '600' }}>
            {Number(value) < 0 ? '-' : ''}${Math.abs(Number(value)).toFixed(2)}
          </Text>
        </View>
      ))}
      <View
        style={[
          styles.summaryRow,
          { paddingTop: 16, borderTopWidth: 1, borderTopColor: c.gray200 },
        ]}
      >
        <DisplayText size={28}>Total</DisplayText>
        <DisplayText size={28}>${total.toFixed(2)}</DisplayText>
      </View>
    </View>
  );
  if (!lines.length)
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.offWhite }]} edges={['top']}>
        <View style={styles.header}>
          <Text style={{ color: c.accentInk, fontSize: 10, fontWeight: '800', letterSpacing: 1.7 }}>
            SOMETHING GOOD STARTS HERE
          </Text>
          <DisplayText size={38} weight="heavy">
            Your bag
          </DisplayText>
        </View>
        <View style={styles.empty}>
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 40,
              backgroundColor: c.butter,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <Ionicons name="bag-handle-outline" size={54} color={c.onButter} />
          </View>
          <DisplayText size={32}>Room for a local favourite.</DisplayText>
          <Text style={{ color: c.textLight, fontSize: 15, lineHeight: 23, textAlign: 'center' }}>
            Your next great meal is just around the corner.
          </Text>
          <GradientButton
            title="Explore local stores"
            onPress={() => router.push('/(tabs)')}
            style={{ alignSelf: 'stretch', marginTop: 16 }}
          />
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.offWhite }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={{ color: c.accentInk, fontSize: 10, fontWeight: '800', letterSpacing: 1.7 }}>
          THE GOOD PART
        </Text>
        <DisplayText size={38} weight="heavy">
          Your bag
        </DisplayText>
        <Text style={{ fontSize: 14, color: c.textLight, marginTop: 5 }}>
          {restaurant?.name ?? 'Your local favourite'} · {lines.reduce((n, l) => n + l.quantity, 0)}{' '}
          {lines.reduce((n, l) => n + l.quantity, 0) === 1 ? 'item' : 'items'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Badge
            label={mode === 'pickup' ? 'Pickup' : 'Delivery'}
            icon={mode === 'pickup' ? 'bag-handle-outline' : 'bicycle-outline'}
            tone="accent"
          />
          {mode === 'pickup' || merchant?.pickupEnabled ? (
            <Pressable
              onPress={() => setMode(mode === 'delivery' ? 'pickup' : 'delivery')}
              accessibilityRole="button"
              style={{ padding: 8 }}
            >
              <Text style={{ color: c.accentInk, fontSize: 13, fontWeight: '700' }}>
                Switch to {mode === 'pickup' ? 'delivery' : 'pickup'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <View
          style={{
            borderRadius: 20,
            paddingHorizontal: 16,
            backgroundColor: c.white,
            borderWidth: 1,
            borderColor: c.gray200,
          }}
        >
          {lines.map((l) => (
            <View key={l.lineId} style={[styles.line, { borderBottomColor: c.gray200 }]}>
              <RemoteImage
                urlString={l.item.imageURL}
                fallbackIcon={l.item.icon}
                style={{ width: 64, height: 72 }}
                borderRadius={14}
              />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: c.navy }}>
                  {l.item.name}
                </Text>
                {l.selections?.length ? (
                  <Text style={{ fontSize: 11, color: c.textLight }}>
                    {l.selections.flatMap((s) => s.choiceNames).join(', ')}
                  </Text>
                ) : null}
                {l.notes ? (
                  <Text style={{ fontSize: 11, color: c.textLight }}>{l.notes}</Text>
                ) : null}
                <Text style={{ color: c.navy, fontWeight: '700' }}>
                  ${cartLineUnitPrice(l).toFixed(2)}
                </Text>
                <QuantityStepper
                  quantity={l.quantity}
                  label={l.item.name}
                  onAdd={() => increment(l.lineId)}
                  onRemove={() => decrement(l.lineId)}
                />
              </View>
            </View>
          ))}
        </View>
        <View
          style={{
            backgroundColor: c.white,
            padding: 20,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: c.gray200,
            gap: 20,
          }}
        >
          {summary}
        </View>
        {ready && quoted.error ? (
          <View style={{ gap: 10 }}>
            <Text accessibilityRole="alert" style={{ color: c.danger }}>
              {quoted.error}
            </Text>
            <Pressable onPress={quoted.refresh} accessibilityRole="button">
              <Text style={{ color: c.accentInk, fontWeight: '700' }}>Refresh total</Text>
            </Pressable>
            {promo ? (
              <Pressable onPress={() => setPromo(null)}>
                <Text style={{ color: c.accentInk }}>Remove promotion</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.bottom, { backgroundColor: c.white, borderTopColor: c.gray200 }]}>
        <GradientButton
          title={
            quoted.loading
              ? 'Updating your total…'
              : `Review ${mode === 'pickup' ? 'pickup' : 'order'} · $${total.toFixed(2)}`
          }
          onPress={startCheckout}
          disabled={ready && !server}
        />
      </View>
      {promoOpen ? (
        <BottomSheet
          visible={promoOpen}
          interactionDisabled={promoBusy}
          onClose={() => {
            setPromoOpen(false);
            setDrawer(true);
          }}
          title="A little extra local love"
          subtitle="Enter your promotion code."
          footer={
            <GradientButton
              title="Apply promotion"
              loading={promoBusy}
              onPress={async () => {
                if (!rid) return;
                setPromoBusy(true);
                setPromoError('');
                try {
                  const code = promoDraft.trim().toUpperCase();
                  if (!code) throw new Error('Enter a promotion code.');
                  await quoteCart(lines, rid, mode, tip, code);
                  setPromo(code);
                  setPromoOpen(false);
                  setDrawer(true);
                  setConfirm(false);
                } catch (e) {
                  setPromoError(e instanceof Error ? e.message : 'That code could not be applied.');
                } finally {
                  setPromoBusy(false);
                }
              }}
            />
          }
        >
          <TextInput
            accessibilityLabel="Promotion code"
            placeholder="Promotion code"
            placeholderTextColor={c.textLight}
            autoCapitalize="characters"
            value={promoDraft}
            onChangeText={setPromoDraft}
            maxLength={40}
            style={{
              padding: 16,
              backgroundColor: c.gray100,
              color: c.navy,
              fontSize: 16,
              borderRadius: 14,
            }}
          />
          {promoError ? (
            <Text accessibilityRole="alert" style={{ color: c.danger }}>
              {promoError}
            </Text>
          ) : null}
          {promo ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPromo(null);
                setPromoOpen(false);
                setDrawer(true);
              }}
            >
              <Text style={{ color: c.accentInk }}>Remove current promotion</Text>
            </Pressable>
          ) : null}
        </BottomSheet>
      ) : instructionsOpen ? (
        <BottomSheet
          visible={instructionsOpen}
          interactionDisabled={instructionBusy}
          onClose={() => {
            if (!instructionBusy) {
              setInstructionsOpen(false);
              setDrawer(true);
            }
          }}
          title="Make the handoff yours"
          subtitle="Help your courier find you."
          footer={
            <GradientButton
              title="Save delivery instructions"
              loading={instructionBusy}
              onPress={async () => {
                if (!address) return;
                setInstructionBusy(true);
                try {
                  await saveAddress({
                    ...address,
                    id: address.id,
                    makeDefault: true,
                    deliveryPreference: preference,
                    instructions,
                  });
                  setInstructionsOpen(false);
                  setDrawer(true);
                } catch {
                  setInstructionError('Could not save your instructions. Please try again.');
                } finally {
                  setInstructionBusy(false);
                }
              }}
            />
          }
        >
          <View style={{ gap: 10 }}>
            {(['Leave at door', 'Meet at door'] as const).map((p) => (
              <Pressable
                key={p}
                accessibilityRole="radio"
                accessibilityState={{ checked: p === preference }}
                onPress={() => setPreference(p)}
                style={[
                  styles.detail,
                  {
                    borderColor: p === preference ? c.orange : c.gray200,
                    backgroundColor: p === preference ? c.accentSoft : c.white,
                  },
                ]}
              >
                <Ionicons
                  name={p === 'Leave at door' ? 'home-outline' : 'person-outline'}
                  size={23}
                  color={c.navy}
                />
                <Text style={{ fontWeight: '700', color: c.navy }}>{p}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: instructions.includes('Please ring the doorbell.') }}
            onPress={() =>
              setInstructions((text) =>
                text.includes('Please ring the doorbell.')
                  ? text.replace('Please ring the doorbell.', '').trim()
                  : `${text.trim()}\nPlease ring the doorbell.`.trim(),
              )
            }
            style={[styles.detail, { borderColor: c.gray200 }]}
          >
            <Ionicons
              name={
                instructions.includes('Please ring the doorbell.') ? 'checkbox' : 'square-outline'
              }
              size={24}
              color={c.accentInk}
            />
            <Text style={{ color: c.navy, fontWeight: '600' }}>Ring the doorbell</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Doorbell and delivery instructions"
            placeholder="Doorbell, entrance, or anything else we should know…"
            placeholderTextColor={c.textLight}
            multiline
            maxLength={2000}
            value={instructions}
            onChangeText={setInstructions}
            style={{
              minHeight: 110,
              padding: 16,
              fontSize: 15,
              lineHeight: 22,
              color: c.navy,
              backgroundColor: c.gray100,
              borderRadius: 16,
              textAlignVertical: 'top',
            }}
          />
          {instructionError ? <Text style={{ color: c.danger }}>{instructionError}</Text> : null}
        </BottomSheet>
      ) : (
        <BottomSheet
          visible={drawer}
          interactionDisabled={processing}
          onClose={() => {
            if (!processing) {
              setDrawer(false);
              setConfirm(false);
            }
          }}
          title={confirm ? 'Ready to make it local?' : 'Checkout'}
          subtitle={restaurant?.name}
          footer={
            <View style={{ gap: 10 }}>
              {error ? (
                <Text accessibilityRole="alert" style={{ color: c.danger, lineHeight: 20 }}>
                  {error}
                </Text>
              ) : null}
              {confirm ? (
                <Text style={{ fontSize: 13, lineHeight: 20, color: c.textLight }}>
                  Confirm {mode === 'pickup' ? 'pickup' : 'delivery'} for ${total.toFixed(2)}.{' '}
                  {__DEV__ ? 'Development checkout uses simulated payment.' : ''}
                </Text>
              ) : null}
              <GradientButton
                title={
                  !__DEV__
                    ? 'Ordering unavailable'
                    : confirm
                      ? `Confirm order · $${total.toFixed(2)}`
                      : 'Review and confirm'
                }
                loading={processing}
                disabled={!__DEV__ || (ready && !server)}
                onPress={() => (confirm ? void submit() : setConfirm(true))}
              />
            </View>
          }
        >
          <Badge
            label={mode === 'pickup' ? 'Collect from the store' : 'Delivered to your door'}
            tone="accent"
          />
          <Pressable
            accessibilityRole={mode === 'pickup' ? undefined : 'button'}
            disabled={mode === 'pickup'}
            onPress={() => {
              if (mode === 'pickup') return;
              setDrawer(false);
              router.push('/address');
            }}
            style={[styles.detail, { borderColor: c.gray200 }]}
          >
            <Ionicons
              name={mode === 'pickup' ? 'storefront-outline' : 'location-outline'}
              size={23}
              color={c.navy}
            />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontWeight: '700', color: c.navy, fontSize: 15 }}>
                {mode === 'pickup' ? restaurant?.name : address?.addressLine}
              </Text>
              <Text style={{ color: c.textLight, fontSize: 12, lineHeight: 18 }}>
                {mode === 'pickup'
                  ? restaurant?.address
                  : address?.apartmentSuite || 'Delivery address'}
              </Text>
            </View>
            {mode === 'delivery' ? (
              <Ionicons name="chevron-forward" color={c.textLight} size={16} />
            ) : null}
          </Pressable>
          {mode === 'delivery' ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setPreference(address?.deliveryPreference ?? 'Leave at door');
                  setInstructions(address?.instructions ?? '');
                  setInstructionError('');
                  setDrawer(false);
                  setInstructionsOpen(true);
                }}
                style={[styles.detail, { borderColor: c.gray200 }]}
              >
                <Ionicons name="chatbox-outline" size={23} color={c.navy} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontWeight: '700', color: c.navy }}>Delivery instructions</Text>
                  <Text style={{ color: c.textLight, fontSize: 12 }}>
                    {address?.deliveryPreference}
                    {address?.instructions ? ` · ${address.instructions}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" color={c.textLight} size={16} />
              </Pressable>
              <View style={{ paddingVertical: 12 }}>
                <TipSelector
                  subtotal={subtotal}
                  percent={percent}
                  custom={custom}
                  onSelect={(p) => {
                    setPercent(p);
                    setCustom('');
                    setConfirm(false);
                  }}
                  onCustom={(v) => {
                    setCustom(v);
                    setConfirm(false);
                  }}
                />
              </View>
            </>
          ) : null}
          {ready ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDrawer(false);
                setPromoOpen(true);
                setPromoError('');
              }}
              style={[styles.detail, { borderColor: c.gray200 }]}
            >
              <Ionicons name="pricetag-outline" size={22} color={c.accentInk} />
              <Text style={{ color: c.accentInk, fontWeight: '700', flex: 1 }}>
                {promo ? `Promotion: ${promo}` : 'Add a promotion code'}
              </Text>
              <Ionicons name="add" color={c.accentInk} size={20} />
            </Pressable>
          ) : null}
          <View style={{ paddingTop: 16 }}>{summary}</View>
          {quoted.loading ? <Text style={{ color: c.textLight }}>Updating your total…</Text> : null}
          {quoted.error ? (
            <Text accessibilityRole="alert" style={{ color: c.danger }}>
              {quoted.error}
            </Text>
          ) : null}
        </BottomSheet>
      )}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10, gap: 4 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  line: {
    paddingVertical: 18,
    flexDirection: 'row',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'flex-start',
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bottom: { padding: 20, borderTopWidth: 1 },
  detail: {
    minHeight: 72,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
});
