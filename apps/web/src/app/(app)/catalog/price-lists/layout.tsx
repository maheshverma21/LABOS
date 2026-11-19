import type { Metadata } from "next";

export const metadata: Metadata = { title: "Price lists" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
