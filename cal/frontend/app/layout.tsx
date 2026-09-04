import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AccMeet Calendar — Schedule Events",
  description:
    "Connect your Google Calendar and schedule meeting follow-ups instantly. Part of the AccMeet meeting copilot.",
  keywords: ["AccMeet", "Google Calendar", "meeting scheduler", "calendar integration"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
