import { createTheme } from 'superdoc';
import 'superdoc/style.css';

type ThemeConfig = Parameters<typeof createTheme>[0];

const productTheme = {
  name: 'product',
  colors: {
    action: '#4f46e5',
    actionHover: '#4338ca',
    bg: '#f8fafc',
    text: '#1e293b',
    border: '#cbd5e1',
  },
  radius: '8px',
  // `colors.bg` also feeds `--sd-layout-page-bg`, which paints the document page. Pin the
  // page so a dark UI surface does not darken pages whose DOCX sets no background.
  vars: { '--sd-layout-page-bg': '#ffffff' },
} satisfies ThemeConfig;

const themeClass = createTheme(productTheme);
document.documentElement.classList.add(themeClass);
