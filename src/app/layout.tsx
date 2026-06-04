import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Impedance Studio",
  description: "Scientific workbench for EIS and 2nd-NLEIS impedance analysis.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
