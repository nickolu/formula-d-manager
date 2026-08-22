import StandingsRedirect from "./StandingsRedirect";

/**
 * The old, season-less standings URL.
 *
 * Kept because tablets and phones have it bookmarked, and game night is a bad
 * time to find a 404. It sends you straight to the current season's standings —
 * never chaining through another redirect, the same rule the race view renames
 * follow, because a second round trip on house wifi buys nothing.
 *
 * Not a next.config redirect: the destination is a document id nobody knows
 * until the seasons collection has been read.
 */
export default function StandingsPage() {
  return <StandingsRedirect />;
}
