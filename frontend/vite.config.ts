import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Import port configuration
const config = require('../config.js')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: config.FRONTEND_PORT,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${config.BACKEND_PORT}`,
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      },
      '/health': {
        target: `http://127.0.0.1:${config.BACKEND_PORT}`,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
