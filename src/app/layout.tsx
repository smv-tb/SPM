import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// One rounded sans for the whole interface: headings 700, body 400, labels 600.
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: "Smartvie PM",
  description: "Smartvie Ecosystem — Project Management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The proxy mints a nonce per request (S5.1); an inline script needs it to run under the CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={nunito.variable}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
