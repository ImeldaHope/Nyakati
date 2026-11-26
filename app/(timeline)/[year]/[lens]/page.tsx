import type { Metadata } from "next";
import { FIRST_YEAR, LENSES, LENS_ORDER, yearsBetween, type Lens } from "@/lib/timeline";
import RoomData from "../room";

export const dynamicParams = false;

// /1963 shows every event; each lens filters them at /1963/<lens>.
export function generateStaticParams() {
  return yearsBetween(FIRST_YEAR, new Date().getFullYear()).flatMap((year) =>
    LENS_ORDER.map((lens) => ({ year: String(year), lens })),
  );
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; lens: Lens }> }): Promise<Metadata> {
  const { year, lens } = await params;
  return { title: `${year} · ${LENSES[lens].label} · Nyakati` };
}

export default async function YearLensPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  return <RoomData year={Number(year)} />;
}
