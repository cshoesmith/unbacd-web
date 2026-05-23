import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "un'bac'd",
  description: 'Real-time BAC tracking, powered by Untappd',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#080604] text-white antialiased min-h-screen">{children}</body>
    </html>
  );
}
