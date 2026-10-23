import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { getStore, isDatabaseConfigured } from "@/db/client";
import { getShellInfo, type ShellInfo } from "@/lib/queries";
import { getAccessMode } from "@/lib/server/context";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], weight: ["400"] });

export const metadata: Metadata = {
  title: { default: "Freshroots Demand Planning", template: "%s | Freshroots Demand Planning" },
  description: "Rule-based demand planning for a regional FMCG distributor. Case-study prototype.",
};

async function loadShell(): Promise<ShellInfo | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    return await getShellInfo(getStore().db);
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [info, mode] = await Promise.all([loadShell(), getAccessMode()]);
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AppShell info={info} mode={mode}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
