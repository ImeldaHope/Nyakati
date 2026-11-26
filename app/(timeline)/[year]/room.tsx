import RoomSeed from "@/components/RoomSeed";
import { readDecade, readIndex } from "@/lib/data";
import { decadeOf } from "@/lib/decades";

// Shared by /1963 and /1963/culture: hands the decade's events to the shell's room.
export default function RoomData({ year }: { year: number }) {
  const decade = decadeOf(year);
  if (!readIndex().decades.includes(decade)) return null;
  return <RoomSeed decade={decade} data={readDecade(decade)} />;
}
