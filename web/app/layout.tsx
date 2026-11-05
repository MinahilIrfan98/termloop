import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Termloop — AI terms, made simple",
  description: "A calm, school-safe AI term explainer for curious students.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="en" className="h-full antialiased"><body className="min-h-full flex flex-col">{children}</body></html>;
}
