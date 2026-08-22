import SeasonStandings from "./SeasonStandings";

export default async function SeasonStandingsPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SeasonStandings seasonId={seasonId} />;
}
