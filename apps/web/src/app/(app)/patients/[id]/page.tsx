import { PatientView } from "./patient-view";

export default async function PatientPage(props: PageProps<"/patients/[id]">) {
  const { id } = await props.params;
  return <PatientView id={id} />;
}
