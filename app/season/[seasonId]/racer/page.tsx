import SeasonRacerView from "./SeasonRacerView";

export default async function SeasonRacerPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SeasonRacerView seasonId={seasonId} />;
}
