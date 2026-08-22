import Nav from "./Nav";
import RaceList from "./RaceList";

/**
 * The player landing. A player arrives cold, on a phone, with no navigation
 * history — so the root is a list of races and nothing else, and one tap lands
 * them in their race's player view. Bookmark it once and it never changes
 * between game nights.
 *
 * No new-race form here: creating a race is commissioner work, and it lives at
 * /admin.
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl p-5">
      <Nav />
      <h1 className="text-3xl font-semibold">Formula D</h1>
      <p className="mt-1 text-neutral-500">Tap your race.</p>
      <RaceList variant="player" />
    </main>
  );
}
