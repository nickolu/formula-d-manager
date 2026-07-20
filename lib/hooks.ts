"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebase";
import { liveDoc } from "./race";
import type { LiveState, Participant, Player, PlayerId, Race } from "./types";

/**
 * onSnapshot is server-push over Firestore's persistent connection, not a poll:
 * it fires when the document changes. One listener per screen, one read per
 * change.
 */
export function useLiveState(raceId: string) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      liveDoc(raceId),
      (snap) => {
        setLive(snap.exists() ? (snap.data() as LiveState) : null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [raceId]);

  return { live, loading, error };
}

export function usePlayers() {
  const [players, setPlayers] = useState<Map<PlayerId, Player>>(new Map());

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "players"), (snap) => {
      setPlayers(
        new Map(
          snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as Player]),
        ),
      );
    });
    return unsubscribe;
  }, []);

  return players;
}

/** Lap counts live on participants because cars cross the line independently. */
export function useParticipants(raceId: string) {
  const [participants, setParticipants] = useState<Map<PlayerId, Participant>>(
    new Map(),
  );

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "races", raceId, "participants"),
      (snap) => {
        setParticipants(
          new Map(snap.docs.map((d) => [d.id, d.data() as Participant])),
        );
      },
    );
    return unsubscribe;
  }, [raceId]);

  return participants;
}

export function useRaces() {
  const [races, setRaces] = useState<Race[]>([]);

  useEffect(() => {
    const q = query(collection(db, "races"), orderBy("scheduledAt", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setRaces(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Race));
    });
    return unsubscribe;
  }, []);

  return races;
}

/**
 * A repaint loop, not a clock and not a poll: it touches no network and simply
 * re-reads the system clock so the derived countdown re-renders.
 */
export function useNow(intervalMs = 100) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
