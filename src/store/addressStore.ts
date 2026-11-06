import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import type {
  Address,
  AddressType,
  DeliveryPreference,
  PersonalLabel,
} from '../types';
import { loadAddresses, saveAddresses } from '../lib/storage';

export function addressDisplayName(a: Address): string {
  if (a.personalLabel === 'Custom' && a.customLabelName) return a.customLabelName;
  if (a.personalLabel !== 'None') return a.personalLabel;
  return a.addressLine;
}

interface SaveInput {
  id?: string;
  addressLine: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  addressType?: AddressType;
  apartmentSuite?: string;
  entryCode?: string;
  buildingName?: string;
  deliveryPreference?: DeliveryPreference;
  instructions?: string;
  personalLabel?: PersonalLabel;
  customLabelName?: string;
  makeDefault?: boolean;
}

interface AddressState {
  ownerEmail: string | null;
  allAddresses: Address[];
  defaultAddress: Address | null;

  configure: (email: string | null) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
  save: (input: SaveInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

function sortAddresses(list: Address[]): Address[] {
  return [...list].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
}

let ownerGeneration = 0;

export const useAddressStore = create<AddressState>((set, get) => ({
  ownerEmail: null,
  allAddresses: [],
  defaultAddress: null,

  configure: async (email) => {
    const generation = ++ownerGeneration;
    set({ ownerEmail: email, allAddresses: [], defaultAddress: null });
    if (!email) {
      set({ ownerEmail: null, allAddresses: [], defaultAddress: null });
      return;
    }
    let list = sortAddresses(await loadAddresses(email));
    // Ensure something is marked default so the home header shows an address.
    if (list.length > 0 && !list.some((a) => a.isDefault)) {
      list[0].isDefault = true;
      await saveAddresses(email, list);
      list = sortAddresses(list);
    }
    if (generation !== ownerGeneration || get().ownerEmail !== email) return;
    set({
      ownerEmail: email,
      allAddresses: list,
      defaultAddress: list.find((a) => a.isDefault) ?? null,
    });
  },

  setDefault: async (id) => {
    const generation = ownerGeneration;
    const email = get().ownerEmail;
    if (!email) return;
    const list = get().allAddresses.map((a) => ({ ...a, isDefault: a.id === id }));
    const sorted = sortAddresses(list);
    await saveAddresses(email, sorted);
    if (generation !== ownerGeneration || get().ownerEmail !== email) return;
    set({ allAddresses: sorted, defaultAddress: sorted.find((a) => a.isDefault) ?? null });
  },

  save: async (input) => {
    const generation = ownerGeneration;
    const email = get().ownerEmail;
    if (!email) return;
    let list = [...get().allAddresses];

    if (input.id) {
      const idx = list.findIndex((a) => a.id === input.id);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          addressLine: input.addressLine,
          postalCode: input.postalCode ?? list[idx].postalCode,
          latitude: input.latitude ?? list[idx].latitude,
          longitude: input.longitude ?? list[idx].longitude,
          addressType: input.addressType ?? list[idx].addressType,
          apartmentSuite: input.apartmentSuite ?? '',
          entryCode: input.entryCode ?? '',
          buildingName: input.buildingName ?? '',
          deliveryPreference: input.deliveryPreference ?? list[idx].deliveryPreference,
          instructions: input.instructions ?? '',
          personalLabel: input.personalLabel ?? list[idx].personalLabel,
          customLabelName: input.customLabelName ?? '',
          updatedAt: new Date().toISOString(),
        };
        if (input.makeDefault) {
          list = list.map((a) => ({ ...a, isDefault: a.id === input.id }));
        }
      }
    } else {
      const shouldBeDefault = input.makeDefault || list.length === 0;
      if (shouldBeDefault) list = list.map((a) => ({ ...a, isDefault: false }));
      list.push({
        id: Crypto.randomUUID(),
        ownerEmail: email,
        isDefault: shouldBeDefault,
        latitude: input.latitude ?? 0,
        longitude: input.longitude ?? 0,
        sortOrder: list.length,
        addressLine: input.addressLine,
        postalCode: input.postalCode ?? '',
        addressType: input.addressType ?? 'House',
        apartmentSuite: input.apartmentSuite ?? '',
        entryCode: input.entryCode ?? '',
        buildingName: input.buildingName ?? '',
        deliveryPreference: input.deliveryPreference ?? 'Leave at door',
        instructions: input.instructions ?? '',
        personalLabel: input.personalLabel ?? 'None',
        customLabelName: input.customLabelName ?? '',
        updatedAt: new Date().toISOString(),
      });
    }

    const sorted = sortAddresses(list);
    await saveAddresses(email, sorted);
    if (generation !== ownerGeneration || get().ownerEmail !== email) return;
    set({ allAddresses: sorted, defaultAddress: sorted.find((a) => a.isDefault) ?? null });
  },

  remove: async (id) => {
    const generation = ownerGeneration;
    const email = get().ownerEmail;
    if (!email) return;
    let list = get().allAddresses.filter((a) => a.id !== id);
    if (list.length > 0 && !list.some((a) => a.isDefault)) list[0].isDefault = true;
    const sorted = sortAddresses(list);
    await saveAddresses(email, sorted);
    if (generation !== ownerGeneration || get().ownerEmail !== email) return;
    set({ allAddresses: sorted, defaultAddress: sorted.find((a) => a.isDefault) ?? null });
  },
}));
