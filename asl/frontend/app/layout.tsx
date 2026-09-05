import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASL Translator",
  description: "Local ASL alphabet recognition prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
