/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // Design system — dark premium SaaS palette
        bg:      '#0a0b0e',
        surface: '#111318',
        card:    '#161b22',
        border:  '#21262d',
        muted:   '#8b949e',
        accent:  {
          DEFAULT: '#1a73e8',
          hover:   '#1557b0',
          light:   '#8ab4f8',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
