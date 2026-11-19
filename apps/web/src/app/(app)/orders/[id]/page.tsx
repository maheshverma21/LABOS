import { OrderView } from "./order-view";

export default async function OrderPage(props: PageProps<"/orders/[id]">) {
  const { id } = await props.params;
  const { new: isNew } = await props.searchParams;
  return <OrderView id={id} justCreated={isNew === "1"} />;
}
