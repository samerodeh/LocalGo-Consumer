'use strict';

// EAS runs this before installing dependencies. Never print configuration values.
if (process.env.EAS_BUILD_PROFILE === 'production') {
  const required = [
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_GOER_API_URL',
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  const invalid = [];
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_GOER_API_URL']) {
    const value = process.env[name];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) invalid.push(name);
    } catch {
      invalid.push(name);
    }
  }
  if (process.env.EXPO_PUBLIC_SERVER_CART_ENABLED !== 'true') invalid.push('EXPO_PUBLIC_SERVER_CART_ENABLED');
  if (missing.length || invalid.length) {
    console.error(`Production EAS configuration is incomplete. Missing: ${missing.join(', ') || 'none'}; invalid: ${invalid.join(', ') || 'none'}.`);
    process.exitCode = 1;
  }
}