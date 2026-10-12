import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Podcast Ecosystem Radar",
  description:
    "Weekly intelligence on guests, topics and sponsors across the Indian startup podcast ecosystem.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body>
        <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-0 lg:flex-row lg:p-5">
          <Sidebar />
          <main className="min-w-0 flex-1 rounded-none bg-shell/90 p-4 ring-1 ring-line backdrop-blur sm:p-6 lg:rounded-3xl lg:p-8">
            <TopBar />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
