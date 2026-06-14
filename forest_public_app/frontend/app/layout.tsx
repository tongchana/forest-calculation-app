import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";

const displayFont = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
});

const bodyFont = Plus_Jakarta_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Forest Survey Workspaces",
  description: "Separate web workspaces for forest biomass calculations and profile diagram rendering.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>{children}</body>
    </html>
  );
}
