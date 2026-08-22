import ResultsView from "./ResultsView";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <ResultsView raceId={raceId} />;
}
