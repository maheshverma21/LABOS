import { redirect } from "next/navigation";

// The separate orders list is gone: billing starts from Registration / Billing.
export default function OrdersPage() {
  redirect("/patients");
}
