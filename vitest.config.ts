import { defineConfig } from 'vitest/config';
import path from 'node:path';

try {
  process.loadEnvFile('.env.local');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NEXT_PUBLIC_GOOGLE_STAFF_SHEET_ID: 'demo_staff_sheet',
      NEXT_PUBLIC_GOOGLE_SCHEDULE_SHEET_ID: 'demo_schedule_sheet',
      NEXT_PUBLIC_GOOGLE_CONCERTS_SHEET_ID: 'demo_concerts_sheet',
      TELEGRAM_BOT_USERNAME: 'DemoShiftsBot',
    },
    include: ['tests/**/*.test.ts'],
    // Файлы с базой сносят общую схему — параллельно их запускать нельзя.
    fileParallelism: false,
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
