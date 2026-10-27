/** YOLOA design tokens: YOLOA brand blues on the calm neutral surfaces used by the LearnSpace reference. */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: { DEFAULT: '#2b59ce', dark: '#2626ae', soft: '#e7ecfb', nav: '#d9e2fb', 50: '#f4f6fe' },
        ink: { DEFAULT: '#172034', soft: '#465065', muted: '#697386', nav: '#373739' },
        line: '#e8eaf0',
        ground: '#f7f8fc',
        success: { DEFAULT: '#0f9d75', soft: '#e3f6ef' },
        danger: { DEFAULT: '#dc4854', soft: '#fdecee' },
        warning: { DEFAULT: '#b45309', soft: '#fdf3e2' },
        accent: { coral: '#ff7f7f', purple: '#7b70ee' },
      },
      borderRadius: { card: '16px' },
      boxShadow: {
        card: '0 10px 25px rgba(23,32,52,.06)',
        pop: '0 20px 45px -12px rgba(23,32,52,.25)',
      },
      backgroundImage: {
        hero: 'linear-gradient(180deg, #4e68a5 0%, #b5c4d2 100%)',
        learning: 'linear-gradient(135deg, #2626ae 0%, #2b59ce 60%, #4f7ae6 100%)',
      },
    },
  },
  plugins: [],
}
