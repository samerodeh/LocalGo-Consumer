const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Isolate localhost verification from the real Supabase values in .env files.
if (process.env.LOCALGO_VERIFY === '1') config.resolver.blockList = [/\/\.env(?:\.[^/]*)?$/];
module.exports = config;
