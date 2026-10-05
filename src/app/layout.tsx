import type { Metadata, Viewport } from 'next';
import { Inter, Lora } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { BRAND_COLORS, BRAND_NAME } from '@/lib/brand';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin', 'cyrillic'] });
// Только для словесной марки «Анненкирхе» (font-brand).
const lora = Lora({ variable: '--font-lora', subsets: ['latin', 'cyrillic'], weight: '600' });

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: 'Запись на смены',
};

// Цвет строки браузера на телефоне — фон страницы в своей теме.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BRAND_COLORS.background },
    { media: '(prefers-color-scheme: dark)', color: BRAND_COLORS.backgroundDark },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ru" className={`${inter.variable} ${lora.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
