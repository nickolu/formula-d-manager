import SettingsSection from "../SettingsSection";

export default async function SeasonSettingsPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <SettingsSection seasonId={seasonId} />;
}
