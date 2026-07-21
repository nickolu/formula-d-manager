import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The table devices have the old URLs bookmarked, and game night is a bad
  // time to discover a 404.
  async redirects() {
    return [
      {
        source: "/race/:raceId/table",
        destination: "/race/:raceId/device",
        permanent: true,
      },
      {
        source: "/race/:raceId/entry",
        destination: "/race/:raceId/edit",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
