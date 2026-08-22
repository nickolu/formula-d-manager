import RaceList from "@/app/RaceList";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return (
    <>
      <p className="mt-5 text-neutral-500">Tap your race.</p>
      <RaceList variant="player" seasonId={seasonId} />
    </>
  );
}
