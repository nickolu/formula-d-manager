import PlayerView from "./PlayerView";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <PlayerView raceId={raceId} />;
}
