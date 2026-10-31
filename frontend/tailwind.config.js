/** YOLOA design tokens: YOLOA brand blues on calm neutral surfaces.
 *  Every colour is a CSS variable (an "R G B" triplet) defined for the light and dark themes in src/index.css,
 *  so components use one set of class names (bg-surface, text-ink, border-line, …) in both themes. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // `dark` is the strong brand tone for text on soft brand surfaces; `strong` is the hover tone of brand buttons.
        brand: { DEFAULT: token('brand'), dark: token('brand-dark'), strong: token('brand-strong'), soft: token('brand-soft'),
          nav: token('brand-nav'), 50: token('brand-50') },
        ink: { DEFAULT: token('ink'), soft: token('ink-soft'), muted: token('ink-muted'), nav: token('ink-nav') },
        surface: token('surface'),
        line: token('line'),
        ground: token('ground'),
        scrim: token('scrim'),
        success: { DEFAULT: token('success'), soft: token('success-soft') },
        danger: { DEFAULT: token('danger'), soft: token('danger-soft') },
        warning: { DEFAULT: token('warning'), soft: token('warning-soft') },
        accent: { coral: token('accent-coral'), purple: token('accent-purple') },
      },
      borderRadius: { card: '16px' },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
      },
      backgroundImage: {
        hero: 'linear-gradient(180deg, #4e68a5 0%, #b5c4d2 100%)',
        learning: 'linear-gradient(135deg, #2626ae 0%, #2b59ce 60%, #4f7ae6 100%)',
      },
    },
  },
  plugins: [],
}
