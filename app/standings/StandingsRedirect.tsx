"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Nav from "@/app/Nav";
import { useCurrentSeason } from "@/lib/hooks";

export default function StandingsRedirect() {
  const { season, loading } = useCurrentSeason();
  const router = useRouter();

  useEffect(() => {
    // replace, not push: this URL is a signpost, and it should not sit in the
    // back stack waiting to bounce the player forward again.
    if (season) router.replace(`/season/${season.id}/standings`);
  }, [season, router]);

  return (
    <main className="mx-auto w-full max-w-2xl p-5">
      <Nav />
      <h1 className="text-3xl font-semibold">Standings</h1>
      <p className="mt-4 text-neutral-500">
        {loading || season
          ? "Finding the current season…"
          : "No season yet. The commissioner makes one from the admin page."}
      </p>
    </main>
  );
}
