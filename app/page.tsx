import SeasonRaces from "./SeasonRaces";

/**
 * The player landing. A player arrives cold, on a phone, with no navigation
 * history — so the root is a list of races and nothing else, and one tap lands
 * them in their race's player view. Bookmark it once and it never changes
 * between game nights.
 *
 * Seasons deliberately did NOT turn this into a picker. The season is named in
 * the header with a switcher beside it; the page is the same shape forever.
 *
 * No new-race form here: creating a race is commissioner work, and it lives at
 * /admin.
 */
export default function Home() {
  return <SeasonRaces />;
}
