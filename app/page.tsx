import Link from "next/link";
import NewRaceForm from "./NewRaceForm";
import RaceList from "./RaceList";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold">Formula D</h1>
        <Link href="/standings" className="text-sm text-emerald-500">
          standings
        </Link>
      </div>
      <NewRaceForm />
      <RaceList />
    </main>
  );
}
