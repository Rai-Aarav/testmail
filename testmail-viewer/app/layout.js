import './globals.css';

export const metadata = {
  title: 'Inbox — testmail.app',
  description: 'Read testmail.app inboxes by tag.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#111217' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
