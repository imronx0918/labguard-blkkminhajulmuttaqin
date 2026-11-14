/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      colors: {
        navy: { 50: '#eef3fb', 100: '#d9e3f5', 200: '#b3c6ea', 300: '#7f9fd8', 400: '#4f78c2', 500: '#2f5aa8', 600: '#21468a', 700: '#1a376e', 800: '#142a55', 900: '#0d1d3d', 950: '#08132a' },
        soft: { 50: '#f2f7ff', 100: '#e3eeff', 200: '#c9ddff', 300: '#a3c4fb', 400: '#7aa7f3' },
      },
      boxShadow: { card: '0 1px 2px rgba(13,29,61,.04), 0 4px 16px -8px rgba(13,29,61,.12)' },
    },
  },
  plugins: [],
};
