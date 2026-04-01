/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#b9e6ff',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5a9',
          600: '#0891b2',
          700: '#075985',
          800: '#064e63',
          900: '#063642',
        },
        neon: {
          cyan: '#00F5D4',
          violet: '#7C3AED',
          pink: '#FF2D95'
        },
        surface: {
          50: '#0b1221',
          100: '#0f1724'
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'bounce-slow': 'bounce 2s infinite',
      }
    },
  },
  plugins: [],
}
