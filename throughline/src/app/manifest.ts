import type { MetadataRoute } from 'next';

/**
 * Web app manifest — makes Throughline installable (home-screen icon, full-screen
 * launch, its own window) on iOS Safari and Android Chrome, and is the same
 * identity the native shell will carry. Opens on the athlete's home.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Throughline',
    short_name: 'Throughline',
    description: 'Your adaptive endurance coach: a plan that rebuilds around real workouts, real recovery, and where you actually stand.',
    start_url: '/me',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0c1018',
    theme_color: '#0c1018',
    categories: ['health', 'sports', 'fitness'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
