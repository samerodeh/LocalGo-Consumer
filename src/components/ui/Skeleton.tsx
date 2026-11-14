import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  View,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme/ThemeContext';
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(280);
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduce(v);
    });
    const s = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      s.remove();
    };
  }, []);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 1, duration: 1300, useNativeDriver: true }),
    );
    loop.start();
    return () => {
      loop.stop();
      progress.setValue(0);
    };
  }, [reduce, progress]);
  return (
    <View
      accessible={false}
      pointerEvents="none"
      onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
      style={[styles.block, { backgroundColor: colors.gray200 }, style]}
    >
      {!reduce ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-width, width],
                  }),
                },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={['transparent', colors.skeletonShine, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ block: { borderRadius: 14, overflow: 'hidden' } });
