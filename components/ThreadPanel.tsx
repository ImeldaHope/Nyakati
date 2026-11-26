import Link from "next/link";
import type { Thread } from "@/lib/timeline";

// The thread's name and story, and its events as plain links: the river draws the brass line,
// this panel is what a screen reader (or a browser without JavaScript) gets.
export default function ThreadPanel({ thread }: { thread: Thread }) {
  return (
    <aside className="thread-panel" aria-labelledby="thread-title">
      <p className="thread-kicker">
        Thread · <Link href="/">Leave</Link>
      </p>
      <h1 id="thread-title" className="thread-title">
        {thread.title}
      </h1>
      <p className="thread-description">{thread.description}</p>
      <details className="thread-events">
        <summary>
          {thread.events.length} event{thread.events.length === 1 ? "" : "s"}
        </summary>
        <ol>
          {thread.events.map((e) => (
            <li key={e.id}>
              <Link href={`/${e.date.slice(0, 4)}`}>
                <span className="thread-year">{e.date.slice(0, 4)}</span> {e.title}
              </Link>
            </li>
          ))}
        </ol>
      </details>
    </aside>
  );
}
