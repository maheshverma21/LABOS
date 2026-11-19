import { InvoicePrint } from "./invoice-print";

export default async function InvoicePage(props: PageProps<"/print/invoice/[id]">) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  return <InvoicePrint id={id} letterhead={query.letterhead !== "0"} portal={query.portal === "1"} />;
}
