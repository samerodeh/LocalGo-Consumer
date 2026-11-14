import type { Restaurant } from '../types';
import { Partner } from './partner';

/** Partners the app is currently integrated with. */
export const alTaib: Restaurant = {
  id: 'al-taib',
  name: Partner.name,
  cuisine: Partner.tagline,
  address: Partner.address,
  logoURL: Partner.logoURL,
  heroImageURL:
    'https://betterresto.s3.us-west-1.wasabisys.com/production/13125/all_dressed_pizza_bb4e2f9ccd.png',
  heroIcon: 'flame',
  distance: '400 m',
  deliveryTime: Partner.etaMinutes,
  deliveryFee: '$5.00 delivery fee',
  hasMenu: true,
};

/** Real listing scraped from chateaukabab.com (Downtown location). */
export const chateauKabab: Restaurant = {
  id: 'chateau-kabab',
  name: 'Château Kabab',
  cuisine: 'Persian & Iraqi Grill',
  address: '2140 Rue Guy, Montreal, QC',
  logoURL:
    'https://betterresto.s3.us-west-1.wasabisys.com/production/13126/812053f8_8814_46c4_ba75_bf4fb65be016_afde25f69c.jpeg',
  heroImageURL:
    'https://betterresto.s3.us-west-1.wasabisys.com/production/13126/18_151_Chateau_Kabab_226_79bd645e70.jpg',
  heroIcon: 'flame',
  distance: '1.2 km',
  deliveryTime: '30 min',
  deliveryFee: '$5.00 delivery fee',
  hasMenu: true,
};

export const restaurants: Restaurant[] = [alTaib, chateauKabab];

export function restaurantById(id: string): Restaurant | undefined {
  return restaurants.find((r) => r.id === id);
}
