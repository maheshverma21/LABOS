import { TestEditor } from "../_components/test-editor";

// The editor sets its own <title>.
export default async function NewTestPage(props: PageProps<"/catalog/new">) {
  const { panel } = await props.searchParams;
  return <TestEditor isPanel={panel === "1"} />;
}
