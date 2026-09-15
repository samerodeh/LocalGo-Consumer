import type { MenuItem } from '../types';

const S3 = 'https://betterresto.s3.us-west-1.wasabisys.com/production';

/** Al Taib's real menu (altaib.ca — Boulangerie & Grills, 2125 Guy St, Montreal). */
export const menuItems: MenuItem[] = [
  { id: 'create-your-bowl-500-g', name: 'Create your bowl (500 g)', category: 'Create your bowl', price: 12.5, icon: 'fast-food', itemDescription: 'Pick up to 5 items of approximately 100 grams each', imageURL: `${S3}/13143/create_your_bowl_cad88be568.png` },
  { id: 'create-your-bowl-1-kg', name: 'Create your bowl (1 kg)', category: 'Create your bowl', price: 25.0, icon: 'fast-food', itemDescription: 'Pick up to 10 items of approximately 100 grams each', imageURL: `${S3}/13143/create_your_bowl_cad88be568.png` },
  { id: 'cheese-pizza-slice', name: 'Cheese Pizza Slice', category: 'Pizza Slices', price: 5.5, icon: 'pizza', itemDescription: 'Sauce, mozzarella.', imageURL: `${S3}/13143/cheese_slice_0c1b5d0a47.png` },
  { id: 'pepperoni-pizza-slice', name: 'Pepperoni Pizza Slice', category: 'Pizza Slices', price: 6.5, icon: 'pizza', itemDescription: 'Sauce, mozzarella, and pepperoni.', imageURL: `${S3}/13143/pepperoni_slice_f644633f4c.png` },
  { id: 'all-dressed-pizza-slice', name: 'All Dressed Pizza Slice', category: 'Pizza Slices', price: 6.75, icon: 'pizza', itemDescription: 'Sauce, mozzarella, pepperoni, mushrooms, and green pepper.', imageURL: `${S3}/13143/all_dressed_slice_c19a53d156.png` },
  { id: 'veggie-pizza-slice', name: 'Veggie Pizza Slice', category: 'Pizza Slices', price: 6.5, icon: 'pizza', itemDescription: 'Sauce, mozzarella, black olives, mushrooms, green peppers, and fresh tomatoes.', imageURL: `${S3}/13143/veggie_slice_ccee3ab83f.png` },
  { id: 'chicken-pizza-slice', name: 'Chicken Pizza Slice', category: 'Pizza Slices', price: 6.75, icon: 'pizza', itemDescription: 'Sauce, mozzarella, chicken, and fresh tomatoes.', imageURL: `${S3}/13143/chicken_slice_f982ea5d23.png` },
  { id: 'mexican-pizza-slice', name: 'Mexican Pizza Slice', category: 'Pizza Slices', price: 6.75, icon: 'pizza', itemDescription: 'Sauce, mozzarella, spicy beef, fresh tomatoes, banana pepper, and onions.', imageURL: `${S3}/13143/mexican_slice_a47a91c7dc.png` },
  { id: 'hawaiian-pizza-slice', name: 'Hawaiian Pizza Slice', category: 'Pizza Slices', price: 6.5, icon: 'pizza', itemDescription: 'Sauce, mozzarella, beef, and pineapple.', imageURL: `${S3}/13143/hawaiian_slice_37971aa470.png` },
  { id: 'spinach-pizza-slice', name: 'Spinach Pizza Slice', category: 'Pizza Slices', price: 6.5, icon: 'pizza', itemDescription: 'Sauce, mozzarella, spinach, and black olives.', imageURL: `${S3}/13143/spinach_slice_0c8548dca0.png` },
  { id: 'tuna-pizza-slice', name: 'Tuna Pizza Slice', category: 'Pizza Slices', price: 7.0, icon: 'pizza', itemDescription: 'Sauce, mozzarella, tuna, garlic, and fresh tomatoes.', imageURL: `${S3}/13143/tuna_slice_15fd28f570.png` },
  { id: 'cheese-pizza', name: 'Cheese Pizza', category: 'Pizza', price: 15.18, icon: 'pizza', itemDescription: 'Sauce, mozzarella.', imageURL: `${S3}/13125/cheese_pizza_d9a19c6e43.png` },
  { id: 'pepperoni-pizza', name: 'Pepperoni Pizza', category: 'Pizza', price: 17.94, icon: 'pizza', itemDescription: 'Sauce, mozzarella, and pepperoni.', imageURL: `${S3}/13125/pepperoni_pizza_6ba780a784.png` },
  { id: 'all-dressed-pizza', name: 'All Dressed Pizza', category: 'Pizza', price: 19.32, icon: 'pizza', itemDescription: 'Sauce, mozzarella, pepperoni, mushrooms, and green pepper.', imageURL: `${S3}/13125/all_dressed_pizza_bb4e2f9ccd.png` },
  { id: 'veggie-pizza', name: 'Veggie Pizza', category: 'Pizza', price: 19.32, icon: 'pizza', itemDescription: 'Sauce, mozzarella, black olives, mushrooms, green peppers, and fresh tomatoes.', imageURL: `${S3}/13125/vegetarian_pizza_f4cf83e13c.png` },
  { id: 'chicken-pizza', name: 'Chicken Pizza', category: 'Pizza', price: 20.7, icon: 'pizza', itemDescription: 'Sauce, mozzarella, chicken, and fresh tomatoes.', imageURL: `${S3}/13125/chicken_pizza_be9158cb2b.png` },
  { id: 'mexican-pizza', name: 'Mexican Pizza', category: 'Pizza', price: 20.7, icon: 'pizza', itemDescription: 'Sauce, mozzarella, spicy beef, fresh tomatoes, banana pepper, and onions.', imageURL: `${S3}/13150/Pizza_Mexicaine_b807a305c7.png` },
  { id: 'hawaiian-pizza', name: 'Hawaiian Pizza', category: 'Pizza', price: 20.7, icon: 'pizza', itemDescription: 'Sauce, mozzarella, beef, and pineapple.', imageURL: `${S3}/13125/hawaian_pizza_6bbfef0021.png` },
  { id: 'spinach-pizza', name: 'Spinach Pizza', category: 'Pizza', price: 20.7, icon: 'pizza', itemDescription: 'Sauce, mozzarella, spinach, and black olives.', imageURL: `${S3}/13143/Spinach_pizza_cee764e693.png` },
  { id: 'tuna-pizza', name: 'Tuna Pizza', category: 'Pizza', price: 22.08, icon: 'pizza', itemDescription: 'Sauce, mozzarella, tuna, garlic, and fresh tomatoes.', imageURL: `${S3}/13143/tuna_pizza_9f16649fdc.png` },
  { id: 'zaatar-manakish', name: 'Zaatar Manakish', category: 'Manakish and Pies', price: 4.5, icon: 'restaurant', itemDescription: 'Thyme, sumac, and sesame seeds.', imageURL: `${S3}/13143/3f152295_8aa9_4fda_b772_59656214fbc3_retina_large_jpeg_17c10f7865.jpeg` },
  { id: 'cheese-manakish', name: 'Cheese Manakish', category: 'Manakish and Pies', price: 7.0, icon: 'restaurant', itemDescription: 'Mozzarella and akawi cheese.', imageURL: `${S3}/13143/c9960829_d3c1_456b_9444_ab999d270275_retina_large_jpeg_e8c94c72bd.jpeg` },
  { id: 'zaatar-and-chesse-manakish', name: 'Zaatar and Chesse Manakish', category: 'Manakish and Pies', price: 6.0, icon: 'restaurant', itemDescription: 'Thyme, sumac, sesame seeds, mozzarella, and akawi cheese.', imageURL: `${S3}/13143/a76bf0f8_e501_425b_8b0f_7e2cc79d1dbd_retina_large_jpeg_57e925129b.jpeg` },
  { id: 'kafta-manakish', name: 'Kafta Manakish', category: 'Manakish and Pies', price: 6.5, icon: 'restaurant', itemDescription: 'Ground-beef, green peppers, and kafta spices.', imageURL: null },
  { id: 'sojuk-manakish', name: 'Sojuk Manakish', category: 'Manakish and Pies', price: 11.99, icon: 'restaurant', itemDescription: 'Ground-beef, sujok spices, and tomatoes.', imageURL: `${S3}/13143/OCN_1391_42c877f14a.jpg` },
  { id: 'lahmbajine-manakish', name: 'Lahmbajine Manakish', category: 'Manakish and Pies', price: 7.5, icon: 'restaurant', itemDescription: 'Ground-beef tomato puree, onions, and seven spices.', imageURL: `${S3}/13143/OCN_1386_98464ae4cf.jpg` },
  { id: 'lahmbajine-and-cheese-manakish', name: 'Lahmbajine and cheese Manakish', category: 'Manakish and Pies', price: 6.5, icon: 'restaurant', itemDescription: 'Ground-beef tomato puree, onions, seven spices, and mozzarella.', imageURL: `${S3}/13143/OCN_1385_c8c174407c.jpg` },
  { id: 'feta-manakish', name: 'Feta Manakish', category: 'Manakish and Pies', price: 6.5, icon: 'restaurant', itemDescription: 'Feta and mozzarella cheese and parsley.', imageURL: null },
  { id: 'spinach-pie', name: 'Spinach Pie', category: 'Manakish and Pies', price: 4.5, icon: 'restaurant', itemDescription: 'Spinach, sumac, lemon, and onion.', imageURL: `${S3}/13143/4f6b2bc2_5c70_4414_bb10_c7f5c6732ea6_retina_large_jpeg_852de02cbe.jpeg` },
  { id: 'cheese-pie', name: 'Cheese Pie', category: 'Manakish and Pies', price: 5.0, icon: 'restaurant', itemDescription: 'Mozzarella and sesame seeds.', imageURL: `${S3}/13143/4cce6cf2_0162_45c8_9be2_eafc5de43ea9_retina_large_jpeg_de946c14f4.jpeg` },
  { id: 'half-spinach-half-cheese-pie', name: 'Half-spinach /half-Cheese pie', category: 'Manakish and Pies', price: 5.0, icon: 'restaurant', itemDescription: 'Spinach, sumac lemon, onion, and mozzarella.', imageURL: `${S3}/13143/baa0c76e_b0d1_4a37_a66d_d822d2300f72_retina_large_jpeg_25574eff3d.jpeg` },
  { id: 'falafel-sandwich', name: 'Falafel Sandwich', category: 'Manakish and Pies', price: 9.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'feta-fromage', name: 'Feta Fromage', category: 'Manakish and Pies', price: 7.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'sojok-fromage', name: 'Sojok & Fromage', category: 'Manakish and Pies', price: 8.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'shish-taouk-poulet', name: 'Shish Taouk (Poulet)', category: 'Manakish and Pies', price: 11.99, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'shawarma-boeuf', name: 'Shawarma (Boeuf)', category: 'Manakish and Pies', price: 11.99, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'shish-taouk-plate', name: 'Shish Taouk Plate', category: 'Grills', price: 15.0, icon: 'flame', itemDescription: null, imageURL: `${S3}/13143/Screenshot_2024_02_19_at_5_21_45_PM_a9573c17a3.png` },
  { id: 'shawarma-beef-sandwich', name: 'Shawarma Beef Sandwich', category: 'Grills', price: 8.75, icon: 'flame', itemDescription: null, imageURL: null },
  { id: 'shish-taouk-sandwich', name: 'Shish Taouk Sandwich', category: 'Grills', price: 8.75, icon: 'flame', itemDescription: null, imageURL: null },
  { id: 'chicken-shawarma-trio', name: 'Chicken Shawarma Trio', category: 'Grills', price: 15.0, icon: 'flame', itemDescription: 'Served with a canned drink and a small potato.', imageURL: null },
  { id: 'shawarma-beef-plate', name: 'Shawarma Beef Plate', category: 'Grills', price: 15.0, icon: 'flame', itemDescription: null, imageURL: `${S3}/13143/Screenshot_2024_02_19_at_5_22_03_PM_45487837c1.png` },
  { id: 'falafel-plate', name: 'Falafel Plate', category: 'Grills', price: 13.5, icon: 'flame', itemDescription: null, imageURL: `${S3}/13143/falafel_plate_e1137ab73c.jpeg` },
  { id: 'beef-shawarma-trio', name: 'Beef Shawarma Trio', category: 'Grills', price: 15.0, icon: 'flame', itemDescription: 'Served with a canned drink and a small potato.', imageURL: null },
  { id: 'combo-shish-taouk-and-shawarma-beef-plate', name: 'Combo Shish Taouk and Shawarma Beef Plate', category: 'Grills', price: 15.0, icon: 'flame', itemDescription: null, imageURL: `${S3}/13143/Screenshot_2024_02_19_at_5_27_45_PM_770d82f9a0.png` },
  { id: '2-chicken-shawarma-trio', name: '2 Chicken Shawarma Trio', category: 'Grills', price: 18.99, icon: 'flame', itemDescription: 'Served with a canned drink and a small potato.', imageURL: null },
  { id: 'combo-chicken-and-beef-shawarma-sandwich', name: 'Combo Chicken and Beef Shawarma Sandwich', category: 'Grills', price: 8.75, icon: 'flame', itemDescription: null, imageURL: null },
  { id: 'combo-chicken-and-beef-shawarma-sandwich-trio', name: 'Combo Chicken and Beef Shawarma Sandwich Trio', category: 'Grills', price: 15.0, icon: 'flame', itemDescription: 'Served with a canned drink and a small potato.', imageURL: null },
  { id: 'hummus', name: 'Hummus', category: 'Sides', price: 4.5, icon: 'restaurant', itemDescription: null, imageURL: `${S3}/13129/21eca6d2_c1d4_11ea_97a7_868985124296_hummus_2_1f792b30a3.jpeg` },
  { id: 'poutine', name: 'Poutine', category: 'Sides', price: 12.0, icon: 'restaurant', itemDescription: null, imageURL: `${S3}/13125/poutine_2520d2d6d1.png` },
  { id: 'fries', name: 'Fries', category: 'Sides', price: 5.0, icon: 'restaurant', itemDescription: null, imageURL: `${S3}/13125/fries_dda49325ec.png` },
  { id: 'cheesecake-slice', name: 'Cheesecake Slice', category: 'Sides', price: 6.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'tabouleh', name: 'Tabouleh', category: 'Sides', price: 4.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'fatoush', name: 'Fatoush', category: 'Sides', price: 4.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'hot-potato', name: 'Hot Potato', category: 'Sides', price: 6.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'basmati-rice', name: 'Basmati Rice', category: 'Sides', price: 4.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'cabbage-salad', name: 'Cabbage Salad', category: 'Sides', price: 4.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'baklava-patesserie', name: 'Baklava Patesserie', category: 'Sides', price: 3.5, icon: 'restaurant', itemDescription: 'Pastry made of layers of filo filled with chopped nuts and honey.', imageURL: `${S3}/13189/BAKLAVA_ac76df5512.jpeg` },
  { id: 'salad-bar-100g', name: 'Salad Bar 100g', category: 'Sides', price: 2.5, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'poutine-au-poulet', name: 'Poutine au Poulet', category: 'Sides', price: 15.0, icon: 'restaurant', itemDescription: null, imageURL: `${S3}/13125/poutine_2520d2d6d1.png` },
  { id: 'steak', name: 'Steak', category: 'Sides', price: 15.0, icon: 'restaurant', itemDescription: null, imageURL: `${S3}/13125/poutine_2520d2d6d1.png` },
  { id: 'merguez', name: 'Merguez', category: 'Sides', price: 15.0, icon: 'restaurant', itemDescription: null, imageURL: `${S3}/13125/poutine_2520d2d6d1.png` },
  { id: 'coke', name: 'Coke', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13143/coke_ed428abe25.jpeg` },
  { id: 'diet-coke', name: 'Diet coke', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13143/diet_coke_7f799bce99.jpeg` },
  { id: 'pepsi', name: 'Pepsi', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13178/pepsi_1286_c790a9cc66.jpeg` },
  { id: 'diet-pepsi', name: 'Diet Pepsi', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13181/pepsi_diet_c03b8be8c5.jpeg` },
  { id: 'redbull', name: 'Redbull', category: 'Drinks', price: 4.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13184/redbull_ad8490cbdf.jpeg` },
  { id: 'apple-juice', name: 'Apple Juice', category: 'Drinks', price: 4.5, icon: 'cafe', itemDescription: null, imageURL: null },
  { id: 'perrier', name: 'Perrier', category: 'Drinks', price: 3.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13160/6_19b4873799.jpg` },
  { id: 'water', name: 'Water', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13140/naya_water_72fcedde49.jpg` },
  { id: 'fanta', name: 'Fanta', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13143/Fanta_d7460afddc.jpg` },
  { id: 'sprite', name: 'Sprite', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13170/sprite_865_2eae62a4ba.jpeg` },
  { id: '7-up', name: '7 up', category: 'Drinks', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13181/7up_03dceb42cb.jpeg` },
  { id: 'ayran', name: 'Ayran', category: 'Drinks', price: 5.5, icon: 'cafe', itemDescription: null, imageURL: `${S3}/13160/5_d08a36dd8b.jpg` },
];

/** Distinct categories in menu order. */
export const menuCategories: string[] = menuItems.reduce<string[]>((acc, item) => {
  if (!acc.includes(item.category)) acc.push(item.category);
  return acc;
}, []);

const CK = 'https://betterresto.s3.us-west-1.wasabisys.com/production/13126';
const CK_DRINKS: Record<string, string> = {
  coke: 'https://betterresto.s3.us-west-1.wasabisys.com/production/13178/thumbnail_coke_862_99c329f8ba.jpeg',
  dietCoke: 'https://betterresto.s3.us-west-1.wasabisys.com/production/13178/thumbnail_diet_coke_863_3df1ee16d5.jpeg',
  sprite: 'https://betterresto.s3.us-west-1.wasabisys.com/production/13178/thumbnail_sprite_865_a2649f55a7.jpeg',
  canadaDry: 'https://betterresto.s3.us-west-1.wasabisys.com/production/13144/thumbnail_Canada_Dry_7b50b8d625.jpeg',
  ayran: 'https://betterresto.s3.us-west-1.wasabisys.com/production/13160/thumbnail_5_d08a36dd8b.jpg',
  water: 'https://betterresto.s3.us-west-1.wasabisys.com/production/13140/thumbnail_naya_water_72fcedde49.jpg',
};

/** Château Kabab's real menu (chateaukabab.com — Persian & Iraqi Grill, 2140 Rue Guy, Montreal). */
export const chateauKababMenuItems: MenuItem[] = [
  // Family Special
  { id: 'ck-40-mixed-grill', name: '40. Mixed Grill', category: 'Family Special', price: 79.99, icon: 'flame', itemDescription: 'Meat and chicken served with soup, salad, rice, fries, hummus', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_207_d666f43208.jpg` },
  { id: 'ck-chicken-mixed-grill', name: 'Chicken Mixed Grill', category: 'Family Special', price: 79.99, icon: 'flame', itemDescription: 'Grilled chicken served with soup, salad, rice or fries, hummus', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_203_7fd68ed0a0.jpg` },
  { id: 'ck-mixed-beef-grill', name: 'Mixed Beef Grill', category: 'Family Special', price: 84.99, icon: 'flame', itemDescription: 'Grilled beef served with soup, salad, rice, fries, hummus', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_205_aa6fc48f8c.jpg` },
  { id: 'ck-mixed-kafta-grill', name: 'Mixed Kafta Grill', category: 'Family Special', price: 82.99, icon: 'flame', itemDescription: '7 kafta kabab skewers of your choice, served with salad, rice, fries, garlic potatoes.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_216_eb92ce7b8b.jpg` },
  { id: 'ck-43-mixed-grill', name: '43. Mixed Grill', category: 'Family Special', price: 99.99, icon: 'flame', itemDescription: 'For 3 people: Meat and chicken served with 3 choices between soup and salad, 2 choices between rice and fries, hummus.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_198_d150fb6fdd.jpg` },
  // Appetizers and Salads
  { id: 'ck-hummus', name: 'Hummus', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_006_5e274dcf8f.jpg` },
  { id: 'ck-baba-ghanouj', name: 'Baba Ghanouj', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_074_29ef358c5b.jpg` },
  { id: 'ck-mirza-kasemi', name: 'Mirza Kasemi', category: 'Appetizers and Salads', price: 10.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_082_1e5b96ea97.jpg` },
  { id: 'ck-vine-leaves', name: 'Vine Leaves', category: 'Appetizers and Salads', price: 6.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_079_1a964ffc8f.jpg` },
  { id: 'ck-tabbouleh', name: 'Tabbouleh', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_019_b9cc89dec5.jpg` },
  { id: 'ck-house-salad', name: 'House Salad', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_063_9236165310.jpg` },
  { id: 'ck-maast-o-khiyar', name: 'Maast O Khiyar', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_011_5faf074b7c.jpg` },
  { id: 'ck-kibbe', name: 'Kibbe', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: '2 pieces.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_041_be06ecf55b.jpg` },
  { id: 'ck-fries', name: 'Fries', category: 'Appetizers and Salads', price: 7.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_055_bfb95bdab0.jpg` },
  { id: 'ck-garlic-potatoes', name: 'Garlic Potatoes', category: 'Appetizers and Salads', price: 7.99, icon: 'restaurant', itemDescription: null, imageURL: `https://betterresto.s3.us-west-1.wasabisys.com/production/13126/thumbnail_65229f85_ce09_4f82_bbea_82af3f00362c_cf3d311ffc.jpeg` },
  { id: 'ck-poutine', name: 'Poutine', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_094_5dc2543c41.jpg` },
  { id: 'ck-mixed-maza', name: 'Mixed Maza', category: 'Appetizers and Salads', price: 14.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_045_abf016406c.jpg` },
  { id: 'ck-falafel-plate', name: 'Falafel Plate', category: 'Appetizers and Salads', price: 12.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_022_ae5457202c.jpg` },
  { id: 'ck-vegetarian-plate', name: 'Vegetarian Plate', category: 'Appetizers and Salads', price: 18.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_029_b054049ae9.jpg` },
  { id: 'ck-soup', name: 'Soup', category: 'Appetizers and Salads', price: 7.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_047_c103647f1b.jpg` },
  { id: 'ck-batonnets-de-mozzarella', name: 'Batonnets De Mozzarella', category: 'Appetizers and Salads', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: null },
  // Dishes of the Day
  { id: 'ck-khoresht-ghormeh-sabzi', name: 'Khoresht Ghormeh Sabzi', category: 'Dishes of the Day', price: 22.99, icon: 'restaurant', itemDescription: 'Beef slices cooked with kidney beans, spinach, and herbs.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_127_417578d3e3.jpg` },
  { id: 'ck-zereshk-polo', name: 'Zereshk Polo', category: 'Dishes of the Day', price: 22.99, icon: 'restaurant', itemDescription: 'Chicken thigh cooked with tomato sauce and served with barberries.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_155_ab42775bca.jpg` },
  { id: 'ck-baghali-polo', name: 'Baghali Polo', category: 'Dishes of the Day', price: 24.99, icon: 'restaurant', itemDescription: 'Lamb shank cooked with tomato sauce, served with rice mixed with dill weed and fava beans.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_140_541d284c19.jpg` },
  { id: 'ck-quazi-chateau-kabab', name: 'Quazi Château Kabab', category: 'Dishes of the Day', price: 25.99, icon: 'restaurant', itemDescription: 'Lamb shank cooked with tomato sauce.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_157_18be5965ad.jpg` },
  { id: 'ck-okra', name: 'Okra', category: 'Dishes of the Day', price: 22.99, icon: 'restaurant', itemDescription: 'Beef chops cooked with tomato sauce and okra.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_123_73bd8d3b4a.jpg` },
  { id: 'ck-fasolia', name: 'Fasolia', category: 'Dishes of the Day', price: 22.99, icon: 'restaurant', itemDescription: 'Beef chops cooked with tomato sauce and beans.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_121_d326a8e059.jpg` },
  // The Grills
  { id: 'ck-kabab-beef', name: 'Kabab Beef', category: 'The Grills', price: 25.99, icon: 'flame', itemDescription: 'Two skewers of tender ground beef served with salads and or soup.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_113_a0aff7c205.jpg` },
  { id: 'ck-spicy-kabab', name: 'Spicy Kabab', category: 'The Grills', price: 25.99, icon: 'flame', itemDescription: 'Two skewers of tender and spicy ground lamb served with salads and or soup.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_113_a0aff7c205.jpg` },
  { id: 'ck-chicken-kabab', name: 'Chicken Kabab', category: 'The Grills', price: 22.99, icon: 'flame', itemDescription: 'Two ground chicken skewers served with rice and a side of salad or soup.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_115_6ed2861dcc.jpg` },
  { id: 'ck-mixed-kabab', name: 'Mixed Kabab', category: 'The Grills', price: 24.99, icon: 'flame', itemDescription: '2 Skewers of your choice served with rice and a side of soup or salad.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_061_9f1e487dea.jpg` },
  { id: 'ck-shish-kabab', name: 'Shish Kabab', category: 'The Grills', price: 29.99, icon: 'flame', itemDescription: 'Cut filet mignon skewer.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_102_ea474bea31.jpg` },
  { id: 'ck-chicken-chateau', name: 'Chicken Château', category: 'The Grills', price: 26.99, icon: 'flame', itemDescription: 'Marinated chicken breast brochette with saffron and spices. Served with basmati rice, salad or soup and grilled tomato.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_076_bee611e46b.jpg` },
  { id: 'ck-soltani-chicken', name: 'Soltani Chicken', category: 'The Grills', price: 31.99, icon: 'flame', itemDescription: 'Chateau chicken and your choice of one Kabab skewer. Served with basmati rice, salad or soup and grilled tomato.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_067_ee6bd6364d.jpg` },
  { id: 'ck-soltani-chateau-kabab', name: 'Soltani Château Kabab', category: 'The Grills', price: 40.99, icon: 'flame', itemDescription: 'Chateau chicken and shish kabab. Served with basmati rice, salad or soup and grilled tomato.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_070_447f47e513.jpg` },
  { id: 'ck-saffron-chicken', name: 'Saffron Chicken', category: 'The Grills', price: 26.99, icon: 'flame', itemDescription: 'Delicious chicken thighs marinated in saffron and spice. Served with basmati rice, salad or soup and grilled tomato.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_091_c7afda4fbb.jpg` },
  { id: 'ck-soltani-filet-mignon', name: 'Soltani Filet Mignon', category: 'The Grills', price: 34.99, icon: 'flame', itemDescription: 'Filet mignon brochette & one kabab brochette of your choice.', imageURL: null },
  // Seafood Dishes
  { id: 'ck-grilled-salmon', name: 'Grilled Salmon', category: 'Seafood Dishes', price: 25.99, icon: 'fish', itemDescription: 'Fresh salmon marinated and grilled on charcoal, served with rice and salmon sauce.', imageURL: `https://betterresto.s3.us-west-1.wasabisys.com/production/13126/thumbnail_1e9a6451_b895_47b1_ae1a_3ea97c227b0c_3bbafccd88.jpeg` },
  { id: 'ck-grilled-shrimp', name: 'Grilled Shrimp', category: 'Seafood Dishes', price: 25.99, icon: 'fish', itemDescription: 'Medium size shrimps marinated and grilled on charcoal, served with rice and sauce.', imageURL: `https://betterresto.s3.us-west-1.wasabisys.com/production/13126/thumbnail_bcb302df_e954_40fa_ba61_2f8afebd557b_d91420bf7e.jpeg` },
  // Shawarma
  { id: 'ck-shawarma-chicken', name: 'Shawarma Chicken', category: 'Shawarma', price: 24.99, icon: 'flame', itemDescription: 'Chicken shawarma served with basmati rice, pita bread, garlic, and a salad.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_034_7c8c0763c5.jpg` },
  { id: 'ck-shawarma-beef', name: 'Shawarma Beef', category: 'Shawarma', price: 24.99, icon: 'flame', itemDescription: 'Beef shawarma served with basmati rice, pita bread, hummus, and a salad.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_033_67b097750b.jpg` },
  { id: 'ck-shawarma-chateau', name: 'Shawarma Château', category: 'Shawarma', price: 24.99, icon: 'flame', itemDescription: 'Beef and chicken shawarma served with basmati rice, pita bread, hummus, garlic, and a salad.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_143_9791abf22e.jpg` },
  // Trio Burgers
  { id: 'ck-chateaus-beef-burger', name: "Château's Beef Burger", category: 'Trio Burgers', price: 14.99, icon: 'fast-food', itemDescription: 'Served with fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_160_6c1715e7fd.jpg` },
  { id: 'ck-chicken-burger', name: 'Chicken Burger', category: 'Trio Burgers', price: 14.99, icon: 'fast-food', itemDescription: 'Comes with fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_162_93a51a44b3.jpg` },
  // Pita Trios
  { id: 'ck-trio-pita-shawarma-beef', name: 'Trio Pita Shawarma Beef', category: 'Pita Trios', price: 14.99, icon: 'fast-food', itemDescription: 'With fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_119_f10571358d.jpg` },
  { id: 'ck-trio-pita-shawarma-chicken', name: 'Trio Pita Shawarma Chicken', category: 'Pita Trios', price: 14.99, icon: 'fast-food', itemDescription: 'With fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_118_e780f12d0b.jpg` },
  { id: 'ck-chicken-brochette-pita-trio', name: 'Chicken Brochette Pita Trio', category: 'Pita Trios', price: 14.99, icon: 'fast-food', itemDescription: 'With fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_168_64e3245a0e.jpg` },
  { id: 'ck-trio-pita-beef-kabab', name: 'Trio Pita Beef Kabab', category: 'Pita Trios', price: 10.99, icon: 'fast-food', itemDescription: 'With fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_152_d1426936f8.jpg` },
  { id: 'ck-trio-pita-chicken-kabab', name: 'Trio Pita Chicken Kabab', category: 'Pita Trios', price: 10.99, icon: 'fast-food', itemDescription: 'With fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_153_b219caa6b0.jpg` },
  { id: 'ck-trio-pita-falafel', name: 'Trio Pita Falafel', category: 'Pita Trios', price: 8.99, icon: 'fast-food', itemDescription: 'With fries and a drink.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_173_2a39933a28.jpg` },
  // Rice
  { id: 'ck-rice', name: 'Rice', category: 'Rice', price: 7.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_099_4c4ddf6ea0.jpg` },
  { id: 'ck-baghali-rice', name: 'Baghali Rice', category: 'Rice', price: 9.99, icon: 'restaurant', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_088_3638ea9dba.jpg` },
  // Extras
  { id: 'ck-extra-spicy-beef-kebab-stick', name: 'Extra Spicy Beef Kebab Stick', category: 'Extras', price: 8.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'ck-extra-beef-kebab-stick', name: 'Extra Beef Kebab Stick', category: 'Extras', price: 8.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'ck-extra-chicken-kebab-stick', name: 'Extra Chicken Kebab Stick', category: 'Extras', price: 8.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'ck-white-bean-sauce', name: 'White Bean (Sauce)', category: 'Extras', price: 6.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  { id: 'ck-okra-sauce', name: 'Okra (Sauce)', category: 'Extras', price: 6.0, icon: 'restaurant', itemDescription: null, imageURL: null },
  // Desserts
  { id: 'ck-baklawa', name: 'Baklawa', category: 'Desserts', price: 3.99, icon: 'ice-cream', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_189_ab7f2217e3.jpg` },
  { id: 'ck-basboussa', name: 'Basboussa', category: 'Desserts', price: 3.99, icon: 'ice-cream', itemDescription: null, imageURL: `https://betterresto.s3.us-west-1.wasabisys.com/production/13126/thumbnail_c5fcd4e8_73a5_49cf_9d73_4768b0a53304_1_09ca5d67bb.jpeg` },
  // Beverages
  { id: 'ck-coke', name: 'Coke', category: 'Beverages', price: 2.5, icon: 'cafe', itemDescription: null, imageURL: CK_DRINKS.coke },
  { id: 'ck-diet-coke', name: 'Diet Coke', category: 'Beverages', price: 2.5, icon: 'cafe', itemDescription: null, imageURL: CK_DRINKS.dietCoke },
  { id: 'ck-sprite', name: 'Sprite', category: 'Beverages', price: 2.5, icon: 'cafe', itemDescription: null, imageURL: CK_DRINKS.sprite },
  { id: 'ck-orange-fanta', name: 'Orange Fanta', category: 'Beverages', price: 2.5, icon: 'cafe', itemDescription: null, imageURL: null },
  { id: 'ck-sprite-zero', name: 'Sprite Zero', category: 'Beverages', price: 2.5, icon: 'cafe', itemDescription: null, imageURL: null },
  { id: 'ck-canada-dry', name: 'Canada Dry', category: 'Beverages', price: 2.5, icon: 'cafe', itemDescription: null, imageURL: CK_DRINKS.canadaDry },
  { id: 'ck-laban-ayran', name: 'Laban Ayran', category: 'Beverages', price: 3.5, icon: 'cafe', itemDescription: null, imageURL: CK_DRINKS.ayran },
  { id: 'ck-bottled-water', name: 'Bottled Water', category: 'Beverages', price: 2.0, icon: 'cafe', itemDescription: null, imageURL: CK_DRINKS.water },
  // Kilos
  { id: 'ck-1kg-brochette-de-poulet-4', name: '1 KG Brochette De Poulet (4)', category: 'Kilos', price: 59.99, icon: 'flame', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_231_d5964e565c.jpg` },
  { id: 'ck-1kg-brochette-de-filet-mignon-4', name: '1 KG Brochette De Filet Mignon (4)', category: 'Kilos', price: 79.99, icon: 'flame', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_231_d5964e565c.jpg` },
  { id: 'ck-1kg-brochette-mixte-4', name: '1 KG Brochette Mixte (4)', category: 'Kilos', price: 69.99, icon: 'flame', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_231_d5964e565c.jpg` },
  { id: 'ck-1kg-mixte-grillades-6', name: '1 KG Mixte Grillades (6)', category: 'Kilos', price: 59.99, icon: 'flame', itemDescription: '1x filet mignon, 1x brochette de poulet, 4x kafta.', imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_227_0e0e97b048.jpg` },
  { id: 'ck-1kg-kafta-mixte-7', name: '1 KG Kafta Mixte (7)', category: 'Kilos', price: 55.99, icon: 'flame', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_220_dd0da79cf8.jpg` },
  { id: 'ck-1kg-saffron-de-poulet-2', name: '1 KG Saffron De Poulet (2)', category: 'Kilos', price: 39.99, icon: 'flame', itemDescription: null, imageURL: `${CK}/thumbnail_18_151_Chateau_Kabab_224_3b8d810a7e.jpg` },
];

/** Distinct categories in menu order. */
export const chateauKababMenuCategories: string[] = chateauKababMenuItems.reduce<string[]>((acc, item) => {
  if (!acc.includes(item.category)) acc.push(item.category);
  return acc;
}, []);

/** Per-restaurant menu lookup so the restaurant screen can render either catalog. */
export function menuItemsForRestaurant(restaurantId: string): MenuItem[] {
  return restaurantId === 'chateau-kabab' ? chateauKababMenuItems : menuItems;
}

export function menuCategoriesForRestaurant(restaurantId: string): string[] {
  return restaurantId === 'chateau-kabab' ? chateauKababMenuCategories : menuCategories;
}

/** Look one item up by id across every catalog — ids are unique app-wide
 *  ('ck-' prefixes Chateau Kabab's). Used to put a photo next to a line on a
 *  past order's receipt, where all the record itself kept was the id, name and
 *  price. Undefined for an item that has since left the menu, which callers
 *  must handle: an old receipt has to keep rendering. */
export function menuItemById(id: string): MenuItem | undefined {
  return (
    menuItems.find((item) => item.id === id) ??
    chateauKababMenuItems.find((item) => item.id === id)
  );
}
