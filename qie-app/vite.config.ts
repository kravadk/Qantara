import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@qie/qantara-sdk': path.resolve(__dirname, '../packages/qantara-sdk/src/index.ts'),
      // @reineira-os/sdk hardcodes the Node entry of @cofhe/sdk. In a browser
      // build the web entry is the correct, bundleable one (the app already
      // uses @cofhe/sdk/web for its own FHE flows).
      '@cofhe/sdk/node': '@cofhe/sdk/web',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['tfhe', 'node-tfhe'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/node_modules/react/') || normalizedId.includes('/node_modules/react-dom/')) {
            return 'react-core';
          }

          if (normalizedId.includes('/node_modules/react-router') || normalizedId.includes('/node_modules/@remix-run/')) {
            return 'router';
          }

          if (normalizedId.includes('/node_modules/@tanstack/')) {
            return 'query';
          }

          if (
            normalizedId.includes('/node_modules/@wagmi/')
          ) {
            return 'wagmi-core';
          }

          if (normalizedId.includes('/node_modules/wagmi/')) {
            return 'wagmi-core';
          }

          if (normalizedId.includes('/node_modules/viem/')) {
            return 'viem-core';
          }

          if (
            normalizedId.includes('/node_modules/@metamask/') ||
            normalizedId.includes('/node_modules/@walletconnect/') ||
            normalizedId.includes('/node_modules/@reown/') ||
            normalizedId.includes('/node_modules/@coinbase/') ||
            normalizedId.includes('/node_modules/@base-org/') ||
            normalizedId.includes('/node_modules/porto/')
          ) {
            return 'wagmi-core';
          }

          if (
            normalizedId.includes('/node_modules/framer-motion/') ||
            normalizedId.includes('/node_modules/motion/') ||
            normalizedId.includes('/node_modules/lucide-react/')
          ) {
            return 'ui-motion';
          }

          if (
            normalizedId.includes('/node_modules/react-markdown/') ||
            normalizedId.includes('/node_modules/remark-') ||
            normalizedId.includes('/node_modules/unified/') ||
            normalizedId.includes('/node_modules/mdast-') ||
            normalizedId.includes('/node_modules/hast-')
          ) {
            return 'markdown';
          }

          if (normalizedId.includes('/node_modules/jspdf/')) {
            return 'pdf-export';
          }

          if (normalizedId.includes('/node_modules/html2canvas/')) {
            return 'canvas-export';
          }

          if (normalizedId.includes('/node_modules/i18next/') || normalizedId.includes('/node_modules/react-i18next/')) {
            return 'i18n';
          }

          return undefined;
        },
      },
    },
  },
  server: {
    hmr: process.env.DISABLE_HMR !== 'true',
    headers: {
      // Required for TFHE WASM SharedArrayBuffer
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
