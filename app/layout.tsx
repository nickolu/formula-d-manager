import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "./AuthGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Formula D",
  description: "Race timer, game log, and season standings",
};

/**
 * The app is dark-only. This puts `<meta name="color-scheme" content="dark">`
 * in the head, which is what makes the browser draw its own widgets dark — the
 * date picker, the number spinners, the caret, autofill, scrollbars — none of
 * which a Tailwind class can reach.
 *
 * It says the same thing as `color-scheme: dark` in `globals.css`, on purpose:
 * the meta tag is parsed with the head, before the stylesheet has applied, so
 * the first paint of a form control is already right. See globals.css for why
 * there is no light theme to switch to.
 */
export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
