/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        surfaceRaised: 'var(--color-surface-raised)',
        surfaceBorder: 'var(--color-surface-border)',
        textPrimary: 'var(--color-text-primary)',
        textMuted: 'var(--color-text-muted)',
        accent: '#2f81f7',
        accentGreen: '#238636',
        accentGold: '#d29922',
        accentRed: '#da3633',
        featuredBadge: '#a371f7',
      }
    },
  },
  plugins: [],
}
