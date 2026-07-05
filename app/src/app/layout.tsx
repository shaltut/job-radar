import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { JobsShell } from "@/components/jobs-shell";
import { auth } from "@/auth";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = { title: "Job Radar", description: "Job search dashboard" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f172a" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // #129: the nav's Admin link is owner-only. JobsShell is a client component
  // (needs usePathname()) with no <SessionProvider/> in this app, so isOwner
  // is resolved here server-side (session already carries it) and passed down
  // as a prop rather than adding useSession() + a provider just for this.
  const session = await auth();
  const isOwner = !!(session?.user as { isOwner?: boolean } | undefined)?.isOwner;
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased bg-[#0f172a] text-[#f8fafc]`}>
        <JobsShell isOwner={isOwner}>{children}</JobsShell>
      </body>
    </html>
  );
}
