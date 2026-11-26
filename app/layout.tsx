import type { Metadata, Viewport } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT", "WONK"], variable: "--font-fraunces" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  // Absolute URLs for social cards: SITE_URL in production, else the dev server.
  metadataBase: new URL(process.env.SITE_URL || "http://localhost:3000"),
  title: "Nyakati",
  description: "A timeline of Kenya you can walk into, from 1895 to today.",
};

export const viewport: Viewport = {
  themeColor: "#14110F",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
