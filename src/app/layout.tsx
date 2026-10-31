import { Familjen_Grotesk } from "next/font/google";
import "./globals.css";

// Variable font (weights 400-700). One family everywhere, including the activity log.
const sans = Familjen_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata = { title: "RabbitHole", description: "Click anything. Investigate everything. Follow the evidence." };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={sans.variable}><body>{children}</body></html>;
}
