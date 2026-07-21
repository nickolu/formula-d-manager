import DeviceView from "./DeviceView";

export default async function DevicePage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  return <DeviceView raceId={raceId} />;
}
