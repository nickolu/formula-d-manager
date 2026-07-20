"use client";

import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { useEffect, useState } from "react";
import { app } from "@/lib/firebase";

/**
 * Security rules require a signed-in caller, so listeners must not attach until
 * auth resolves or they fail with permission-denied. Anonymous auth is
 * invisible at the table — nobody logs in — while still keeping a stranger who
 * learns the project ID out of the season data.
 *
 * Phase 2 upgrades these anonymous sessions to real accounts for the website.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getAuth(app);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setReady(true);
      } else {
        signInAnonymously(auth).catch((e) => setError(e.message));
      }
    });
    return unsubscribe;
  }, []);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center text-red-500">
        Sign-in failed: {error}
        <br />
        Enable Anonymous sign-in in the Firebase console.
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center text-neutral-500">
        Starting up…
      </main>
    );
  }

  return <>{children}</>;
}
