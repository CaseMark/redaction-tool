import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Smart Redaction Tool | Case.dev",
  description: "Auto-detect and redact PII from legal documents with AI-powered detection and vault-enhanced security.",
  keywords: ["redaction", "PII", "legal documents", "privacy", "document processing", "case.dev"],
  authors: [{ name: "Case.dev" }],
  robots: "noindex, nofollow", // Prevent indexing of sensitive document tool
  openGraph: {
    title: "Smart Redaction Tool",
    description: "Auto-detect and redact PII from legal documents",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <main className="flex-1">{children}</main>
        <footer className="bg-black text-white text-center py-1 text-xs">
          powered with ❤️ by{" "}
          <a 
            href="https://case.dev" 
            target="_blank" 
            rel="noopener noreferrer"
            className="underline hover:text-gray-300"
          >
            case.dev
          </a>
        </footer>
      </body>
    </html>
  );
}
