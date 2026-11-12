import "./ops.css";
import { AppShell } from "@/components/app-shell";

// Operator pages render inside the shadcn/ui sidebar shell. The ops.css tokens keep legacy page widgets on the same palette.
export function OpsShell({ title, sub, children, aside }: { active?: string; title: string; sub?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return <AppShell title={title} sub={sub} aside={aside}><div className="op op-embedded">{children}</div></AppShell>;
}
