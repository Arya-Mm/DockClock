import { notFound } from "next/navigation";
import { driverKey } from "@/lib/server/driver";
import { getLoad } from "@/lib/server/loads";
import { SimApp } from "./sim-app";
import "../../driver/driver.css";
import { overpass } from "../../driver/font";

export const dynamic = "force-dynamic";
export const metadata = { title: "Geofence simulator" };

/** ELD geofence simulator for one load (demo tool, same per-load key as the driver link). */
export default async function SimPage(props: PageProps<"/sim/[id]">) {
  const { id } = await props.params;
  const { k } = await props.searchParams;
  if (typeof k !== "string" || k !== driverKey(id)) notFound();
  const load = await getLoad(id).catch(() => null);
  if (!load) notFound();
  const arrival = load.evidence.filter((e) => e.kind === "ARRIVAL").map((e) => e.utcAt.getTime()).sort((a, b) => a - b)[0] ?? null;
  return (
    <div className={`rd ${overpass.variable}`}>
      <SimApp loadId={id} driverKey={k} facility={{ name: load.facility.name, lat: load.facility.lat, lng: load.facility.lng, radiusM: load.facility.radiusM }}
        arrivalMs={arrival} nowMs={Date.now()} state={load.state} />
    </div>
  );
}
