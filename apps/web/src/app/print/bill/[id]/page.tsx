import { BillPrint } from "./bill-print";

export default async function BillPage(props: PageProps<"/print/bill/[id]">) {
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  return <BillPrint id={id} letterhead={query.letterhead !== "0"} portal={query.portal === "1"} />;
}
