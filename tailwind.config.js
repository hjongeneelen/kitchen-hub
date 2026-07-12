/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#fdfbf7',
          100: '#faf4ea',
          200: '#f3e7d3',
          300: '#e9d6b8',
        },
        terracotta: {
          50: '#fbeee5',
          100: '#f3d3bb',
          200: '#e6ac82',
          300: '#d6864f',
          400: '#c26a34',
          500: '#b5551f',
          600: '#984719',
          700: '#793714',
          800: '#5c2a10',
          900: '#40200f',
        },
        olive: {
          50: '#f3f3e6',
          100: '#e3e3c4',
          200: '#c7c793',
          300: '#a7a86b',
          400: '#8b8d4d',
          500: '#6f7339',
          600: '#575a2d',
          700: '#434622',
        },
        charcoal: {
          50: '#f2f1ef',
          100: '#ddd9d3',
          200: '#b0a99f',
          300: '#7e766c',
          400: '#5a534b',
          500: '#3f3a34',
          600: '#2f2b26',
          700: '#26221e',
          800: '#1c1917',
          900: '#141210',
        },
      },
      fontFamily: {
        sans: ['"Iowan Old Style"', '"Palatino Linotype"', 'Georgia', 'ui-serif', 'serif'],
      },
    },
  },
  plugins: [],
}
