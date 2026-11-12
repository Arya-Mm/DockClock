import { notFound } from "next/navigation";
import { driverKey, snapshot } from "@/lib/server/driver";
import { DriverApp } from "./driver-app";

export const dynamic = "force-dynamic";

export default async function DriverPage(props: PageProps<"/driver/[id]">) {
  const { id } = await props.params;
  const { k } = await props.searchParams;
  // Invalid or missing link: same 404 as an unknown load, so links cannot be probed.
  if (typeof k !== "string" || k !== driverKey(id)) notFound();
  const initial = await snapshot(id).catch(() => null);
  if (!initial) notFound();
  return <DriverApp initial={initial} driverKey={k} />;
}
