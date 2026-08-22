"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import { liveDoc } from "./race";
import { computeStandings } from "./scoring";
import { seasonDoc } from "./seasons";
import type {
  LiveState,
  Participant,
  Player,
  PlayerId,
  Race,
  Season,
} from "./types";

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

/**
 * The races listener, with the first-snapshot flag exposed. The landing page
 * needs it: races start as an empty array, so without it a player arriving on
 * a slow connection reads "no race yet" for a moment before their race appears
 * — which is exactly the wrong thing to tell someone who came to play.
 */
export function useRaceList() {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "races"), orderBy("scheduledAt", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setRaces(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Race));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { races, loading };
}

export function useRaces() {
  return useRaceList().races;
}

/**
 * Scoring config is read live rather than bundled, so house rules can be edited
 * in the Firestore console and every open standings page re-sorts immediately.
 */
export function useSeason(seasonId: string) {
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(seasonDoc(seasonId), (snap) => {
      setSeason(snap.exists() ? ({ id: snap.id, ...snap.data() } as Season) : null);
      setLoading(false);
    });
    return unsubscribe;
  }, [seasonId]);

  return { season, loading };
}

/**
 * Standings are derived, never stored. Both inputs are already streaming, so
 * this adds no reads and cannot drift from the races it summarizes.
 */
export function useStandings(seasonId: string) {
  const races = useRaces();
  const { season, loading } = useSeason(seasonId);

  const standings = useMemo(
    () => (season ? computeStandings(races, season.scoringConfig, seasonId) : []),
    [races, season, seasonId],
  );

  return { standings, season, loading };
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
