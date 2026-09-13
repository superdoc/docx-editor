import {
  buildTheme,
  createTheme,
  type ThemeColors,
  type ThemeConfig,
  type ThemeResult,
  type ThemeVariableOverrides,
} from 'superdoc';

const colors = {
  action: '#2563eb',
  bg: '#f8fafc',
  text: '#0f172a',
  border: '#cbd5e1',
} satisfies ThemeColors;

const vars = {
  '--sd-ui-toolbar-bg': '#eef2ff',
} satisfies ThemeVariableOverrides;

const dynamicVars: Record<string, string> = { '--sd-ui-menu-bg': '#ffffff' };

const productTheme = {
  name: 'product',
  colors,
  radius: '8px',
  vars,
} satisfies ThemeConfig;

const themeClass: string = createTheme(productTheme);
const compatibleTheme: ThemeConfig = { vars: dynamicVars };
const themeResult: ThemeResult = buildTheme(productTheme);
const generatedClass: string = themeResult.className;
const generatedCss: string = themeResult.css;

const invalidVariable = {
  // @ts-expect-error Theme variable names must start with --sd-.
  '--application-toolbar-bg': '#ffffff',
} satisfies ThemeVariableOverrides;

void [themeClass, compatibleTheme, generatedClass, generatedCss, invalidVariable];
