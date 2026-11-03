import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './global.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DocsProvider } from '@/components/docs-provider';
import { GoogleAnalytics } from '@/components/google-analytics';
import { siteOrigin } from '@/lib/site-url';

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: 'SuperDoc Documentation',
    template: '%s | SuperDoc',
  },
  description: 'DOCX Editor and Agent SDK for reviewing, filling, and editing documents. Fully customizable.',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <body>
        <DocsProvider>{children}</DocsProvider>
        <GoogleAnalytics />
      </body>
    </html>
  );
}
