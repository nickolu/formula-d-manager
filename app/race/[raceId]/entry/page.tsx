import EntryView from "./EntryView";

export default async function EntryPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <EntryView raceId={raceId} />;
}
