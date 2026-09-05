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
  title: "AccMeet — Calls built for memory care",
  description: "Video calling for people living with memory loss and the families who call them.",
  keywords: ["memory care", "dementia", "accessibility", "video calls", "webrtc"],
  openGraph: {
    title: "AccMeet — Calls built for memory care",
    description: "Video calling for people living with memory loss and the families who call them.",
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
            // Toasts are the only channel for some errors, so they need to
            // outlast a quick glance.
            duration: 8000,
            style: {
              background: "var(--color-navy-800)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-glass-border)",
              borderRadius: "var(--radius-xl)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--fs-body)",
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
