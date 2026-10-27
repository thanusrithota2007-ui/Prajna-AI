import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend mode is the default. Set VITE_USE_MOCK=true to run the local sample evaluator.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
});
