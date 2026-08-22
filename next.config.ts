import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The tablets have old URLs bookmarked, and game night is a bad time to
  // discover a 404. Each view has been renamed twice now — table → device →
  // player, entry → edit → results — so every historical path points straight
  // at the current one. Chaining them would cost a second round trip on house
  // wifi for no benefit.
  async redirects() {
    return [
      { source: "/race/:raceId/table", destination: "/race/:raceId/player", permanent: true },
      { source: "/race/:raceId/device", destination: "/race/:raceId/player", permanent: true },
      { source: "/race/:raceId/entry", destination: "/race/:raceId/results", permanent: true },
      { source: "/race/:raceId/edit", destination: "/race/:raceId/results", permanent: true },
      // Teams stopped being a season subview of its own: the panel has to know
      // who you are, which is the claim, so it lives inside Racer rather than
      // opening on "pick your racer first".
      { source: "/season/:seasonId/teams", destination: "/season/:seasonId/racer", permanent: true },
    ];
  },
};

export default nextConfig;
