import PlayerTabs from "./PlayerTabs";

/**
 * The frame every player subview shares.
 *
 * Subviews are real routes, not conditional render state: a player arrives
 * cold, on a phone, with no navigation history, and has to be able to land on
 * any subview by URL and reload without losing their place.
 *
 * params is a Promise in Next 16 and must be awaited. This is a server
 * component, so it can be async; the tab bar it hands the id to is the client
 * half.
 *
 * app/Nav.tsx is deliberately absent — it stays opt-in, and this view has its
 * own navigation. The paradigm is that players never leave the player view.
 */
export default async function PlayerLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Clears the fixed tab bar, so the last row of any subview is reachable. */}
      <div className="pb-24">{children}</div>
      <PlayerTabs raceId={raceId} />
    </div>
  );
}
