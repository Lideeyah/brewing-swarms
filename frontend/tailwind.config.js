/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      keyframes: {
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(22px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up':   'fade-up 0.65s cubic-bezier(0.16,1,0.3,1) both',
        'fade-up-1': 'fade-up 0.65s 0.12s cubic-bezier(0.16,1,0.3,1) both',
        'fade-up-2': 'fade-up 0.65s 0.22s cubic-bezier(0.16,1,0.3,1) both',
        'fade-up-3': 'fade-up 0.65s 0.32s cubic-bezier(0.16,1,0.3,1) both',
        'fade-up-4': 'fade-up 0.65s 0.44s cubic-bezier(0.16,1,0.3,1) both',
        'fade-up-5': 'fade-up 0.65s 0.56s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in':   'fade-in 0.5s ease both',
        'fade-in-1': 'fade-in 0.5s 0.15s ease both',
      },
      colors: {
        arc: {
          green:  '#10b981',
          amber:  '#f59e0b',
          red:    '#ef4444',
          bg:     '#000000',
          surface:'#09090b',
          border: '#18181b',
          muted:  '#71717a',
          sub:    '#a1a1aa',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
