import { redirect } from "next/navigation";

// Platform admins sign in at the one sign-in page now; old links and bookmarks still work.
export default async function AdminLoginPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { expired } = await props.searchParams;
  redirect(expired === "1" ? "/login?expired=1" : "/login");
}
