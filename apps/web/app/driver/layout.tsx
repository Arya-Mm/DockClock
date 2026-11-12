import type { Metadata, Viewport } from "next";
import { overpass } from "./font";
import "./driver.css";

export const metadata: Metadata = {
  title: "DockClock driver",
  description: "Your dock wait clock, offers and pay.",
  manifest: "/driver.webmanifest",
  appleWebApp: { capable: true, title: "DockClock", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#2B2F33", width: "device-width", initialScale: 1 };

export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return <div className={`rd ${overpass.variable}`}>{children}</div>;
}
