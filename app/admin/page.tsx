import Nav from "@/app/Nav";
import SeasonsAdmin from "./SeasonsAdmin";

/**
 * The commissioner's page — everything the root page used to be. It moved so
 * that `/` can belong to players: the site root is the only URL anyone needs
 * to know, and the first thing a player sees should not be a new-race form.
 *
 * It is now a season layer above the races. The season is the unit of identity
 * and a race is a thing that happens inside one, so the races live at
 * /admin/season/:seasonId rather than here.
 *
 * Nothing hides this route. There is no auth to gate it with yet and
 * pretending otherwise would be theatre; Phase 2's real accounts are where it
 * actually gets gated.
 */
export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <Nav standings={false} />
      <h1 className="text-3xl font-semibold">League admin</h1>
      <SeasonsAdmin />
    </main>
  );
}
