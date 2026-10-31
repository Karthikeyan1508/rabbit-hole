import type { Metadata } from 'next';
import { Familjen_Grotesk } from 'next/font/google';
import './globals.css';

const familjenGrotesk = Familjen_Grotesk({
  subsets: ['latin'],
  variable: '--font-familjen',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RabbitHole - Follow the Evidence',
  description: 'Turn any company, claim, or relationship into an evidence-backed investigation graph.',
  icons: {
    icon: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={familjenGrotesk.variable}>
      <body className="antialiased min-h-screen bg-[#fbfbfd] text-[#14213d] flex flex-col font-sans selection:bg-[#2457d6]/15 selection:text-[#14213d]">
        {children}
      </body>
    </html>
  );
}

