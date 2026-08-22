import Nav from "@/app/Nav";
import NewRaceForm from "@/app/NewRaceForm";
import RaceList from "@/app/RaceList";

/**
 * The commissioner's page — everything the root page used to be. It moved so
 * that `/` can belong to players: the site root is the only URL anyone needs
 * to know, and the first thing a player sees should not be a new-race form.
 *
 * Nothing hides this route. There is no auth to gate it with yet and
 * pretending otherwise would be theatre; Phase 2's real accounts are where it
 * actually gets gated.
 */
export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <Nav />
      <h1 className="text-3xl font-semibold">Race admin</h1>
      <NewRaceForm />
      <RaceList variant="admin" />
    </main>
  );
}
