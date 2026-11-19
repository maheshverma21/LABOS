import { PublicReport } from "./public-report";

export const metadata = { title: "Your lab report", robots: { index: false, follow: false } };

export default async function PublicReportPage(props: PageProps<"/r/[token]">) {
  const { token } = await props.params;
  return <PublicReport token={token} />;
}
