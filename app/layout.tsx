import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WatchParty — Your people. Your movie. One moment.",
  description:
    "Bring your favorite people together for a cozy movie night, wherever you are. Create a temporary WatchParty room and share its code.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
