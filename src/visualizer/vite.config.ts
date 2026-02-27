import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Proxy WS through Vite to bypass Cloudflare bot protection.
// The browser worker connects to ws://localhost:PORT/ws/... and
// Vite forwards to the real Perpl WS server.
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/ws/mainnet': {
        target: 'wss://perpl.xyz',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws\/mainnet/, '/ws/v1/market-data'),
        headers: {
          'Origin': 'https://perpl.xyz',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      },
      '/ws/testnet': {
        target: 'wss://testnet.perpl.xyz',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws\/testnet/, '/ws/v1/market-data'),
        headers: {
          'Origin': 'https://testnet.perpl.xyz',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      },
    },
  },
});
