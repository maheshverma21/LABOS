import { LabelsPrint } from "./labels-print";

export default async function LabelsPage(props: PageProps<"/print/labels/[orderId]">) {
  const { orderId } = await props.params;
  const { all } = await props.searchParams;
  return <LabelsPrint orderId={orderId} all={all === "1"} />;
}
