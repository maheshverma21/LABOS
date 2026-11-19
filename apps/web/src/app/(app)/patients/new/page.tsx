import { redirect } from "next/navigation";

// Registration now lives on the Registration / Billing page.
export default function NewPatientPage() {
  redirect("/patients");
}
