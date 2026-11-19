import type { Metadata } from "next";
import { NewOrder } from "./new-order";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage(props: PageProps<"/orders/new">) {
  const { patientId, accountId } = await props.searchParams;
  return (
    <NewOrder
      initialPatientId={typeof patientId === "string" ? patientId : undefined}
      initialAccountId={typeof accountId === "string" ? accountId : undefined}
    />
  );
}
