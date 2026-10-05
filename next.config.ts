import type { NextConfig } from "next";

/**
 * Заголовки безопасности для всех ответов (страницы, .ics, выгрузка xlsx, API Telegram).
 * CSP — только директивы без script-src/style-src: полная CSP с nonce — отдельная задача.
 * frame-ancestors 'none' и X-Frame-Options: DENY — приложение нельзя встроить в чужой iframe.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
