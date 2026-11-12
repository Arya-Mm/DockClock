import { Overpass } from "next/font/google";

// Overpass is an open-source face modelled on US highway-sign lettering (FHWA Highway Gothic): drivers read it daily.
export const overpass = Overpass({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--rd-font" });
