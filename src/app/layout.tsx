import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "un'bac'd",
  description: 'Real-time BAC tracking, powered by Untappd',
  icons: {
    icon: '/unbacd.png',
    shortcut: '/unbacd.png',
    apple: '/unbacd.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-[#080604]">
      <body className="bg-[#080604] text-white antialiased min-h-[100dvh]">{children}</body>
    </html>
  );
}
