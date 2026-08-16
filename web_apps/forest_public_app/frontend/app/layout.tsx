import "./globals.css";
import type { Metadata } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const thaiFont = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
});

export const metadata: Metadata = {
  title: "Forest Survey Workspaces",
  description: "Separate web workspaces for forest biomass calculations and profile diagram rendering.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${thaiFont.variable}`}>{children}</body>
    </html>
  );
}
