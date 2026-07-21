import EditView from "./EditView";

export default async function EditPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <EditView raceId={raceId} />;
}
