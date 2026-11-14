import { create } from 'zustand';
import { getCatalog, type CatalogMerchant } from '../lib/consumerApi';
import type { FulfillmentMode, MerchantCategory } from '../types/commerce';
interface CommerceState {
  mode: FulfillmentMode;
  category: MerchantCategory;
  merchants: CatalogMerchant[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  setMode: (v: FulfillmentMode) => void;
  setCategory: (v: MerchantCategory) => void;
  refresh: () => Promise<void>;
}
let inflight: Promise<void> | null = null;
export const useCommerceStore = create<CommerceState>((set) => ({
  mode: 'delivery',
  category: 'restaurants',
  merchants: [],
  loading: false,
  ready: false,
  error: null,
  setMode: (mode) => set({ mode }),
  setCategory: (category) => set({ category }),
  refresh: () => {
    if (inflight) return inflight;
    set({ loading: true, error: null });
    inflight = getCatalog()
      .then((merchants) => set({ merchants, ready: true }))
      .catch((error) =>
        set({ error: error instanceof Error ? error.message : 'Stores could not be loaded.' }),
      )
      .finally(() => {
        set({ loading: false });
        inflight = null;
      });
    return inflight;
  },
}));
