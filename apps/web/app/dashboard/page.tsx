import type { Metadata } from "next";
import { connection } from "next/server";
import { getStudioData } from "@/lib/studio-data";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "DockClock analytics" };

export default async function DashboardPage() {
  await connection(); // live ledger: render per request
  const data = await getStudioData();
  const model = process.env.GEMINI_STUDIO_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";
  return (
    <Dashboard
      data={data}
      licenseKey={process.env.AG_STUDIO_LICENSE_KEY ?? process.env.AG_STUDIO}
      aiModels={process.env.GEMINI_API_KEY ? [model] : undefined}
    />
  );
}
