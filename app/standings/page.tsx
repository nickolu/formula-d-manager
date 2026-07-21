import StandingsTable from "./StandingsTable";

export default function StandingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <h1 className="text-3xl font-semibold">Standings</h1>
      <StandingsTable />
    </main>
  );
}
