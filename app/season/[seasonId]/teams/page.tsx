import SeasonTeams from "./SeasonTeams";

export default async function SeasonTeamsPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SeasonTeams seasonId={seasonId} />;
}
