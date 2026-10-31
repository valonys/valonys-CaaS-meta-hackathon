import "./globals.css";
import type { Metadata } from "next";
import { WEBRTC_OFF_SCRIPT } from "@/lib/integrity-copilot/webrtc-off";

export const metadata: Metadata = {
  title: "Integrity Copilot",
  description: "Evidence-linked piping-circuit integrity review on Meta models, with engineer approval",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Runs before any app code: WebRTC constructors replaced with throwing stubs (CSP does not govern WebRTC). */}
        <script dangerouslySetInnerHTML={{ __html: WEBRTC_OFF_SCRIPT }} />
      </head>
      <body className="bg-[#0d0f14] text-gray-100 min-h-screen">{children}</body>
    </html>
  );
}
