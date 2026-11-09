import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative links, so the built site works at https://gwiazda.github.io/kraken/ and in any folder.
  base: './',
  server: {
    // Fixed address: it must match the "Authorized JavaScript origins" of the Google OAuth client.
    host: 'localhost',
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
