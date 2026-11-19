import { SheetView } from "./sheet-view";

export default async function ResultSheetPage(props: PageProps<"/results/[orderId]">) {
  const { orderId } = await props.params;
  return <SheetView orderId={orderId} />;
}
