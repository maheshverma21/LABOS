import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: "Test List", template: `%s · Test List · ${APP_NAME}` },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
