import SeasonAdminShell from "./SeasonAdminShell";

/**
 * The frame every season-admin section shares.
 *
 * The five sections were one long stacked page, which meant scrolling past a
 * whole new-race form to reach the roster and past the roster to reach scoring.
 * They are **real routes** rather than a tab component holding state, the same
 * as the player subviews and for one of the same reasons: the commissioner
 * editing a scoring table and hitting reload should land back on the scoring
 * table, and a link to "the teams page" should be a link.
 *
 * params is a Promise in Next 16 and must be awaited. This is a server
 * component, so it can be async; the shell it hands the id to is the client
 * half that streams the season.
 */
export default async function SeasonAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SeasonAdminShell seasonId={seasonId}>{children}</SeasonAdminShell>;
}
