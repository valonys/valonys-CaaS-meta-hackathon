import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integrity Copilot",
  description: "Evidence-linked piping-circuit integrity review on Meta models, with engineer approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0d0f14] text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
