"use client";

import { seedDecade } from "@/lib/decades";
import type { DecadeData } from "@/lib/timeline";

// Rendered by a year's page before the shell (see app/(timeline)/layout.tsx), so the room
// has its events on the first render: they end up in the static HTML, not fetched later.
export default function RoomSeed({ decade, data }: { decade: number; data: DecadeData }) {
  seedDecade(decade, data);
  return null;
}
