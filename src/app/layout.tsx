import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Server Hub — Local Game Server Manager",
  icons: { icon: "/app-icon.png", apple: "/app-icon.png" },
  description: "Install, run, monitor, back up, and configure real dedicated game servers on your own PC.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
