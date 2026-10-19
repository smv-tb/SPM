import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// One rounded sans for the whole interface: headings 700, body 400, labels 600.
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: "Smartvie PM",
  description: "Smartvie Ecosystem — Project Management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={nunito.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
