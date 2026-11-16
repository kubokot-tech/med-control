// `next dev` evaluates modules with eval (React Refresh); the built app never does
const scriptSrc = process.env.NODE_ENV === 'production' ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // the image optimizer is unused and has had unauthenticated RCE/SSRF advisories
  images: { unoptimized: true },
  // shared dictionaries and modules live outside the app folder (../locales, ../shared)
  experimental: { externalDir: true },
  // The same headers edge (Caddy) sets on the server; the desktop app has no edge in front, so Next sends them itself.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }];
  },
  async redirects() {
    return [
      { source: '/dashboard', destination: '/', permanent: true },
      { source: '/timeline', destination: '/', permanent: true },
    ];
  },
};
export default nextConfig;
