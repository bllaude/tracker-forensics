import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrackerCheck — GPS tracker authenticity checker",
  description:
    "Check whether a SinoTrack-style GPS tracker is genuine or a clone using IMEI validation, SMS firmware fingerprinting and physical checks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
