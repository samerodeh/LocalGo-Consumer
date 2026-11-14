import { useMemo, useRef, useState, useEffect } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../theme/ThemeContext';
import { mapDocument } from './mapDocument';
import { validPoint, type LocalMapProps } from './types';
export default function LocalMap({
  points,
  pin,
  onPinChange,
  label = 'Order locations',
}: LocalMapProps) {
  const { colors: c, isDark } = useTheme();
  const view = useRef<WebView>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => mapDocument(c, isDark), [isDark, c]);
  useEffect(() => {
    if (!loaded) return;
    const data = JSON.stringify({
      points: points.filter(validPoint),
      pin: pin && validPoint(pin) ? pin : null,
      editable: Boolean(onPinChange),
    }).replace(/</g, '\\u003c');
    view.current?.injectJavaScript(`window.updatePoints&&window.updatePoints(${data});true;`);
  }, [loaded, points, pin, onPinChange]);
  return (
    <View
      accessibilityLabel={label}
      style={{
        height: 280,
        width: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: c.gray100,
      }}
    >
      <WebView
        ref={view}
        source={{ html, baseUrl: 'https://localgo-map.invalid' }}
        originWhitelist={['about:blank', 'https://localgo-map.invalid']}
        onShouldStartLoadWithRequest={(r) =>
          r.url === 'about:blank' || r.url.startsWith('https://localgo-map.invalid')
        }
        mixedContentMode="never"
        domStorageEnabled={false}
        onLoadStart={() => setLoaded(false)}
        onError={() => setFailed(true)}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'ready') setLoaded(true);
            else if (data.type === 'error') setFailed(true);
            else if (data.type === 'pin' && validPoint(data))
              onPinChange?.({ latitude: data.latitude, longitude: data.longitude });
          } catch {}
        }}
        style={{ flex: 1 }}
      />
      {failed ? (
        <Text
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            padding: 10,
            backgroundColor: c.white,
            color: c.navy,
            fontSize: 12,
          }}
        >
          Map is unavailable. Use the address details below.
        </Text>
      ) : null}
    </View>
  );
}
