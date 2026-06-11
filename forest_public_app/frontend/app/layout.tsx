import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forest Field Studio",
  description: "Public-facing forest calculation frontend powered by Next.js and a reused Python workflow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
