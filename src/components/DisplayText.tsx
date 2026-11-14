import { Text, type TextProps, type TextStyle } from 'react-native';
import { fonts } from '../theme/theme';

import { useTheme } from '../theme/ThemeContext';

type Weight = 'black' | 'heavy' | 'bold' | 'semibold';

interface Props extends TextProps {
  size: number;
  weight?: Weight;
  color?: string;
}

const familyFor: Record<Weight, string> = {
  heavy: fonts.displayBlack,
  black: fonts.displayBlack,
  bold: fonts.displayBold,
  semibold: fonts.displaySemiBold,
};

/**
 * Barlow Condensed display text for logos, section titles, and hero numbers —
 * the RN counterpart to SwiftUI's `Font.display(_:weight:)`.
 */
export function DisplayText({ size, weight = 'bold', color, style, ...rest }: Props) {
  const { colors } = useTheme();
  const textStyle: TextStyle = {
    fontFamily: familyFor[weight],
    fontSize: size,
    color: color ?? colors.navy,
    // Barlow Condensed sits tight; give headings a touch of breathing room.
    lineHeight: size * 1.12,
  };
  return <Text {...rest} style={[textStyle, style]} />;
}
