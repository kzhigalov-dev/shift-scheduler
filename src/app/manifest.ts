import type { MetadataRoute } from 'next';
import { BRAND_COLORS, BRAND_NAME, BRAND_SHORT_NAME } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_SHORT_NAME,
    description: 'Запись на смены',
    lang: 'ru',
    start_url: '/',
    display: 'standalone',
    background_color: BRAND_COLORS.background,
    theme_color: BRAND_COLORS.primary,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
