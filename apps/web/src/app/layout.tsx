import type { ReactNode } from 'react';

export const metadata = {
  title: 'prisme',
  description: 'The decision layer between thinking and doing.',
};

/**
 * The root layout, and nothing more.
 *
 * The app shell — navigation, theme, tokens, the command palette — belongs to
 * W07 (docs/40-workstreams/W07-design-system.md). W00 deliberately makes no
 * design decision here, because a placeholder shell is something four later
 * workstreams would have to unpick.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
