import RosterSection from "../RosterSection";

export default async function SeasonRosterPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <RosterSection seasonId={seasonId} />;
}
