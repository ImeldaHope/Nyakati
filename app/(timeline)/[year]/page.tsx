import type { Metadata } from "next";
import { FIRST_YEAR, yearsBetween } from "@/lib/timeline";
import RoomData from "./room";

export const dynamicParams = false;

export function generateStaticParams() {
  return yearsBetween(FIRST_YEAR, new Date().getFullYear()).map((year) => ({ year: String(year) }));
}

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return { title: `${year} · Nyakati` };
}

// The year room itself is drawn by the shell in ../layout.tsx, which reads the year from the path.
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  return <RoomData year={Number(year)} />;
}
