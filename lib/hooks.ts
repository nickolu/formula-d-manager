"use client";

import { getAuth, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { app, db } from "./firebase";
import { liveDoc } from "./race";
import { computeStandings, isScorable } from "./scoring";
import {
  seasonDoc,
  seasonEventsCol,
  seasonMembersCol,
  seasonsCol,
} from "./seasons";
import { teamsCol } from "./teams";
import type {
  LiveState,
  Participant,
  Player,
  PlayerId,
  Race,
  RaceEvent,
  Season,
  SeasonEvent,
  SeasonMember,
  Team,
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
export function useRaceList(seasonId?: string) {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Scoped when a season is given — which needs the composite index on
    // (seasonId ASC, scheduledAt DESC) in firestore.indexes.json. Without the
    // index this fails at the table rather than at build time, which is why
    // the index ships before anything depends on it.
    const q = seasonId
      ? query(
          collection(db, "races"),
          where("seasonId", "==", seasonId),
          orderBy("scheduledAt", "desc"),
        )
      : query(collection(db, "races"), orderBy("scheduledAt", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setRaces(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Race));
      setLoading(false);
    });
    return unsubscribe;
  }, [seasonId]);

  return { races, loading };
}

export function useRaces(seasonId?: string) {
  return useRaceList(seasonId).races;
}

/**
 * One race document. Separate from the live doc on purpose: status, track,
 * lapCount and the feature toggles change rarely, while the live doc changes
 * every turn — two listeners means a settings read doesn't ride along with
 * every tick of the game.
 */
export function useRace(raceId: string) {
  const [race, setRace] = useState<Race | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, "races", raceId), (snap) => {
      setRace(snap.exists() ? ({ id: snap.id, ...snap.data() } as Race) : null);
      setLoading(false);
    });
    return unsubscribe;
  }, [raceId]);

  return { race, loading };
}

/**
 * The race's event log, newest first. One listener, like every other hook here.
 *
 * Capped rather than unbounded: a long race is thousands of turnAdvanced
 * events and the history view is something you scroll, not something you audit
 * — the log itself stays complete in Firestore either way.
 *
 * `at` is a serverTimestamp, so it is NULL in the local snapshot until the
 * server acknowledges the write. With the persistent cache on, every event
 * this device writes renders once that way. Callers must not assume it is set.
 */
export function useRaceEvents(raceId: string, max = 300) {
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "races", raceId, "events"),
      orderBy("at", "desc"),
      limit(max),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RaceEvent));
      setLoading(false);
    });
    return unsubscribe;
  }, [raceId, max]);

  return { events, loading };
}

/**
 * Scoring config is read live rather than bundled, so house rules can be edited
 * in the Firestore console and every open standings page re-sorts immediately.
 */
export function useSeason(seasonId: string | null | undefined) {
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Hooks cannot be called conditionally, so a caller that does not yet know
    // which season it wants passes nothing rather than an empty id — which
    // Firestore rejects as a document path.
    if (!seasonId) return;
    const unsubscribe = onSnapshot(seasonDoc(seasonId), (snap) => {
      setSeason(snap.exists() ? ({ id: snap.id, ...snap.data() } as Season) : null);
      setLoading(false);
    });
    return unsubscribe;
  }, [seasonId]);

  return { season, loading };
}

/**
 * Every season, newest first. One listener — the league has a handful of these
 * and they change about once a year.
 *
 * Archived seasons are included: a picker filters them out, and a standings
 * page still has to be able to name the season it is showing.
 */
export function useSeasons() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(seasonsCol(), orderBy("startDate", "desc"));
    const unsubscribe = onSnapshot(q, (snap) => {
      setSeasons(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Season));
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { seasons, loading };
}

/**
 * The season's constructors. One listener; the picker and the slot grid both
 * read it, and the taken-colours map comes from the season document they are
 * already streaming, so no extra listener is needed for that either.
 */
export function useTeams(seasonId: string | null | undefined) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seasonId) return;
    const unsubscribe = onSnapshot(teamsCol(seasonId), (snap) => {
      setTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Team));
      setLoading(false);
    });
    return unsubscribe;
  }, [seasonId]);

  return { teams, loading };
}

/**
 * The season the app is "in" right now: the newest one that has not been
 * archived.
 *
 * Derived rather than flagged, so there is nothing to forget to set — a new
 * season becomes current by existing, and an old one stops being current by
 * being archived. If the commissioner ever wants to pin it, a
 * `seasons/{id}.current` flag read here is the change, and nothing else moves.
 *
 * Note what this does NOT do: `/` is not gated behind it. The root is still a
 * list of races with the season named in the header and a switcher beside it,
 * because the root must not behave differently week to week.
 */
export function useCurrentSeason() {
  const { seasons, loading } = useSeasons();
  const season = useMemo(
    () => seasons.find((s) => !s.archived) ?? null,
    [seasons],
  );
  return { season, seasons, loading };
}

/**
 * Who is in the league this season.
 *
 * This is NOT the grid. It answers "who is in this league", while the live
 * doc's positionOrder answers "who is at the table tonight, and in what order".
 * Someone missing a game night stays a member — which is why they still appear
 * in standings, on zero, rather than being written into a race they did not run.
 */
export function useSeasonMembers(seasonId: string) {
  const [members, setMembers] = useState<SeasonMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(seasonMembersCol(seasonId), (snap) => {
      setMembers(snap.docs.map((d) => d.data() as SeasonMember));
      setLoading(false);
    });
    return unsubscribe;
  }, [seasonId]);

  return { members, loading };
}

/**
 * The season's event log, newest first, shaped exactly like useRaceEvents.
 *
 * Nothing renders this yet, on purpose: the log ships before its view because
 * a team move is otherwise unrecoverable, while the view is cheap to add later.
 * `at` is null until the server acknowledges, same as every race event.
 */
export function useSeasonEvents(seasonId: string, max = 300) {
  const [events, setEvents] = useState<SeasonEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(seasonEventsCol(seasonId), orderBy("at", "desc"), limit(max));
    const unsubscribe = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SeasonEvent));
      setLoading(false);
    });
    return unsubscribe;
  }, [seasonId, max]);

  return { events, loading };
}

/**
 * Standings are derived, never stored. Both inputs are already streaming, so
 * this adds no reads and cannot drift from the races it summarizes.
 */
export function useStandings(seasonId: string) {
  const races = useRaces(seasonId);
  const { season, loading } = useSeason(seasonId);
  const { members } = useSeasonMembers(seasonId);

  // The roster is an input to scoring, not a thing written into races: a member
  // who missed a night appears on zero because computeStandings seeded them,
  // and the race's result still records exactly who was on the grid.
  const memberIds = useMemo(() => members.map((m) => m.playerId), [members]);

  const standings = useMemo(
    () =>
      season
        ? computeStandings(races, season.scoringConfig, seasonId, memberIds)
        : [],
    [races, season, seasonId, memberIds],
  );

  // How many races have actually been run. The standings row's `races` column
  // means *races entered*, and a 0 against a season with seven races run reads
  // very differently from a 0 in a season that has not started — so the view
  // gets both numbers, and "absent" never has to be inferred.
  const racesRun = useMemo(() => races.filter(isScorable).length, [races]);

  return { standings, season, loading, racesRun };
}

/**
 * This device's anonymous auth uid — the identity AuthGate already establishes.
 *
 * Read through a hook rather than calling getAuth() ad-hoc from components, so
 * there is one place that knows where identity comes from when Phase 2 swaps
 * anonymous sessions for real accounts.
 */
export function useUid() {
  const [uid, setUid] = useState<string | null>(null);

  useEffect(
    () => onAuthStateChanged(getAuth(app), (user) => setUid(user?.uid ?? null)),
    [],
  );

  return uid;
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
