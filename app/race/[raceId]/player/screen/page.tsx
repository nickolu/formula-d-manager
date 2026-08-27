import ScreenView from "@/app/ScreenView";

/**
 * The big-screen view, on the phone already in your hand.
 *
 * This route lives OUTSIDE the (framed) group on purpose, so it gets none of
 * the player layout: PlayerHeader plus the fixed tab bar cost about a third of
 * a phone's height held sideways, and this view exists to be nothing but a
 * clock. The `player` variant carries its own way back instead — leaving is
 * not doing something, and a screen with no exit is a trap.
 *
 * params is a Promise in Next 16 and must be awaited. A client component page
 * cannot be async, so this server page unwraps it and hands the id to a client
 * child.
 */
export default async function PlayerScreenPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <ScreenView raceId={raceId} variant="player" />;
}
