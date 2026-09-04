import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "react-hot-toast";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AccMeet — Audio Meetings",
  description: "Simple, instant audio meetings. No downloads required. Built for teams.",
  keywords: ["meetings", "audio", "collaboration", "webrtc"],
  openGraph: {
    title: "AccMeet — Audio Meetings",
    description: "Simple, instant audio meetings. No downloads required.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-animated">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "toast-custom",
            duration: 4000,
            style: {
              background: "var(--color-navy-800)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-glass-border)",
              borderRadius: "var(--radius-xl)",
              fontFamily: "var(--font-sans)",
              fontSize: "0.875rem",
            },
            success: {
              iconTheme: { primary: "var(--color-success)", secondary: "white" },
            },
            error: {
              iconTheme: { primary: "var(--color-danger)", secondary: "white" },
            },
          }}
        />
      </body>
    </html>
  );
}
