import type { Metadata, Viewport } from "next";
import { Overpass } from "next/font/google";
import "./driver.css";

// Overpass is an open-source face modelled on US highway-sign lettering (FHWA Highway Gothic): drivers read it daily.
const overpass = Overpass({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--rd-font" });

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
