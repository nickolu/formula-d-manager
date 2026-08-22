import ScoringSection from "../ScoringSection";

export default async function SeasonScoringPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <ScoringSection seasonId={seasonId} />;
}
