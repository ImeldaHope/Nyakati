import Nyakati from "@/components/Nyakati";
import { readIndex, readNews, readThreads } from "@/lib/data";
import { FIRST_YEAR } from "@/lib/timeline";

// The river, the year rooms and the threads share one client shell, so it stays mounted
// between "/", "/1963" and "/thread/land" and the numeral can travel between them. A year's
// page renders first and seeds its decade's events, so the room has them in the static HTML.
export default function TimelineLayout({ children }: { children: React.ReactNode }) {
  const index = readIndex();
  const lastYear = new Date().getFullYear();
  return (
    <>
      {children}
      <Nyakati
        years={index.years}
        decades={index.decades}
        firstYear={FIRST_YEAR}
        lastYear={lastYear}
        threads={readThreads()}
        news={readNews(lastYear)}
      />
    </>
  );
}
