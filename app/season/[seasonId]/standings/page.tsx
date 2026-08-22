import StandingsTable from "@/app/standings/StandingsTable";

export default async function SeasonStandingsPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <StandingsTable seasonId={seasonId} />;
}
