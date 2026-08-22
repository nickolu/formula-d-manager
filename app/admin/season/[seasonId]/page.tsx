import SeasonAdminView from "./SeasonAdminView";

// params is a Promise in Next 16 and must be awaited. A client component page
// cannot be async, so this server page unwraps it and hands the id to a client
// child — the same shape every route here follows.
export default async function SeasonAdminPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SeasonAdminView seasonId={seasonId} />;
}
