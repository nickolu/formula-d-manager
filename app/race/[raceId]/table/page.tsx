import TableView from "./TableView";

export default async function TablePage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <TableView raceId={raceId} />;
}
