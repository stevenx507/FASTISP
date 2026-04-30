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
        coral: {
          50: '#fff1f0',
          100: '#ffe1df',
          200: '#ffc7c4',
          300: '#ffa09b',
          400: '#ff6961',
          500: '#FF6961',
          600: '#e55e57',
          700: '#bf4f49',
          800: '#993f3a',
          900: '#7d3430',
        },
        ivory: {
          50: '#ffffff',
          100: '#fefcf9',
          200: '#FDF5E6',
          300: '#fbeed1',
          400: '#f9e7bc',
          500: '#f7dfa7',
        },
        neon: {
          cyan: '#00F5D4',
          violet: '#7C3AED',
          pink: '#FF2D95'
        },
        surface: {
          50: '#FDF5E6',
          100: '#f3f4f6'
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'bounce-slow': 'bounce 2s infinite',
        'fade-in': 'fade-in 0.5s ease-out forwards',
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
