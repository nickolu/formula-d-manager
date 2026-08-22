import RacesSection from "./RacesSection";

export default async function SeasonRacesPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <RacesSection seasonId={seasonId} />;
}
