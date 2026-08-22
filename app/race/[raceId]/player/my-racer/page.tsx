import MyRacerView from "./MyRacerView";

// params is a Promise in Next 16 and must be awaited. A client component page
// cannot be async, so this server page unwraps it and hands the id to a client
// child.
export default async function MyRacerPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <MyRacerView raceId={raceId} />;
}
