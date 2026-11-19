import { TestEditorLoader } from "./test-editor-loader";

export default async function TestPage(props: PageProps<"/catalog/[id]">) {
  const { id } = await props.params;
  return <TestEditorLoader id={id} />;
}
