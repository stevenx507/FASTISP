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
          DEFAULT: 'var(--primary-color)',
          hover: 'var(--primary-color-hover)',
          ...{
            50: '#f0f9ff',
            100: '#e0f2fe',
            200: '#b9e6ff',
            300: '#7dd3fc',
            400: '#38bdf8',
            500: 'var(--primary-color)',
            600: 'var(--primary-color-hover)',
            700: '#075985',
            800: '#064e63',
            900: '#063642',
          }
        },
        secondary: {
          DEFAULT: 'var(--secondary-color)',
          500: 'var(--secondary-color)',
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
