import { useEffect, useRef } from 'react';
import { ScrollView, Pressable, Text } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { selectionFeedback } from '../../lib/haptics';
export function MenuCategoryTabs({
  categories,
  active,
  onSelect,
}: {
  categories: string[];
  active: string;
  onSelect: (category: string) => void;
}) {
  const { colors: c } = useTheme();
  const rail = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  useEffect(() => {
    rail.current?.scrollTo({
      x: Math.max(0, (positions.current[active] ?? 0) - 20),
      animated: true,
    });
  }, [active]);
  return (
    <ScrollView
      ref={rail}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 12 }}
      style={{ backgroundColor: c.offWhite, borderBottomWidth: 1, borderBottomColor: c.gray200 }}
    >
      {categories.map((category) => (
        <Pressable
          key={category}
          onLayout={(event) => {
            positions.current[category] = event.nativeEvent.layout.x;
          }}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === category }}
          onPress={() => {
            selectionFeedback();
            onSelect(category);
          }}
          style={{
            minHeight: 42,
            justifyContent: 'center',
            paddingHorizontal: 16,
            borderRadius: 999,
            backgroundColor: active === category ? c.brandNavy : c.white,
            borderWidth: 1,
            borderColor: active === category ? c.brandNavy : c.gray200,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: active === category ? c.onBrand : c.navy,
            }}
          >
            {category}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
