import SeasonShell from "@/app/SeasonShell";

/**
 * The frame every season subview shares — the season name, the switcher, and
 * the Races / Racer / Standings tabs.
 *
 * params is a Promise in Next 16 and must be awaited. This is a server
 * component, so it can be async; the shell it hands the id to is the client
 * half that streams the season.
 */
export default async function SeasonLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SeasonShell seasonId={seasonId}>{children}</SeasonShell>;
}
