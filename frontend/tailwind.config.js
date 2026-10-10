/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d1117',
        surface: '#161b22',
        surfaceRaised: '#21262d',
        surfaceBorder: '#30363d',
        textPrimary: '#f0f6fc',
        textMuted: '#8b949e',
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
