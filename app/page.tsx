import Nav from "./Nav";
import NewRaceForm from "./NewRaceForm";
import RaceList from "./RaceList";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <Nav />
      <h1 className="text-3xl font-semibold">Formula D</h1>
      <NewRaceForm />
      <RaceList />
    </main>
  );
}
