import TeamsSection from "../TeamsSection";

export default async function SeasonTeamsAdminPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <TeamsSection seasonId={seasonId} />;
}
