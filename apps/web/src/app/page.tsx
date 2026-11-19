import { redirect } from "next/navigation";

export default function Home() {
  // The dashboard sends signed-out visitors on to /login.
  redirect("/dashboard");
}
