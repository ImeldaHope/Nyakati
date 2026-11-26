"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import gsap from "gsap";
import River, { type NumeralBox, type RiverHandle } from "./River";
import YearRoom from "./YearRoom";
import { decadeOf, loadDecade, peekDecade } from "@/lib/decades";
import { eventYear, parseRoomPath, roomPath, type NewsFeed, type Thread, type View } from "@/lib/timeline";
import ThreadPanel from "./ThreadPanel";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";

type Phase = "river" | "entering" | "room" | "leaving";

interface Props {
  years: Record<string, number>;
  decades: number[];
  firstYear: number;
  lastYear: number;
  threads: Thread[];
  /** The current year's GDELT headlines, if any: its room opens on the News lens. */
  news: NewsFeed | null;
}

// The transform that puts the room's numeral where the river's numeral is drawn, matching
// width and baseline. The canvas numeral has no DOM box, so baselines line the two up.
function flight(numeral: HTMLElement, box: NumeralBox) {
  const rect = numeral.getBoundingClientRect();
  const baseline = numeral.querySelector("[data-baseline]")!.getBoundingClientRect().top;
  const scale = box.width / rect.width;
  return {
    x: box.left - rect.left,
    y: box.baseline - rect.top - (baseline - rect.top) * scale,
    scale,
    transformOrigin: "0 0",
  };
}

export default function Nyakati({ years, decades, firstYear, lastYear, threads, news }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const route = parseRoomPath(pathname);
  const threadSlug = pathname?.match(/^\/thread\/([a-z0-9-]+)\/?$/)?.[1] ?? null;
  const thread = threads.find((t) => t.slug === threadSlug) ?? null;
  const routeYear = route && route.year >= firstYear && route.year <= lastYear ? route.year : null;
  const routeView = route?.view ?? null;

  const [year, setYear] = useState<number | null>(routeYear);
  const [phase, setPhase] = useState<Phase>(routeYear === null ? "river" : "room");
  const [loadedDecades, setLoadedDecades] = useState(0);
  // The view follows the room's URL. A lens filter dims other lenses' marks on the river; every
  // room opens on all its events.
  const [lens, setLens] = useState<View>(routeView ?? "all");
  const river = useRef<RiverHandle>(null);
  const room = useRef<HTMLElement>(null);
  const fromBox = useRef<NumeralBox | null>(null);
  const lastLeft = useRef<number | null>(null);
  // The year our own router.push is heading to, until the URL catches up.
  const navTarget = useRef<number | null | undefined>(undefined);
  const busy = useRef(false);

  const decade = year === null ? null : decadeOf(year);
  const hasDecade = decade !== null && decades.includes(decade);
  const roomEvents = useMemo(
    () => (hasDecade ? (peekDecade(decade!)?.events ?? []).filter((e) => eventYear(e) === year) : []),
    // loadedDecades re-reads the cache once a decade file arrives.
    [hasDecade, decade, year, loadedDecades], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const roomImages = useMemo(
    () => (hasDecade ? (peekDecade(decade!)?.images ?? []).filter((i) => Number(i.year) === year) : []),
    [hasDecade, decade, year, loadedDecades], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const roomLoading = hasDecade && !peekDecade(decade!);

  useEffect(() => {
    if (roomLoading) loadDecade(decade!).then(() => setLoadedDecades((n) => n + 1));
  }, [roomLoading, decade]);

  const enter = useCallback(
    async (y: number, push = true) => {
      if (phase !== "river" || busy.current || !river.current) return;
      busy.current = true;
      if (decades.includes(decadeOf(y))) await loadDecade(decadeOf(y));
      // Years are entered from the year view, so the numeral is big enough to travel.
      if (river.current.zoom !== "year") await river.current.zoomTo("year", y);
      river.current.reveal(y);
      fromBox.current = river.current.numeralBox(y);
      setYear(y);
      setPhase("entering");
      setLens("all");
      if (push) {
        navTarget.current = y;
        router.push(roomPath(y, "all"), { scroll: false });
      }
    },
    [phase, router, decades],
  );

  const leave = useCallback(
    (push = true) => {
      if (phase !== "room") return;
      setPhase("leaving");
      if (push) {
        navTarget.current = null;
        router.push("/", { scroll: false });
      }
    },
    [phase, router],
  );

  // Arrival: the river drifts to a stop at the current year. A direct link to a
  // year puts the river behind the room at that year, so leaving lands on it.
  useEffect(() => {
    if (routeYear === null) river.current?.arrive(lastYear);
    else river.current?.reveal(routeYear);
    // Mount only.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (routeView) setLens(routeView);
  }, [routeView]);

  // Back and forward buttons: follow the URL once the current move has settled.
  useEffect(() => {
    if (navTarget.current !== undefined) {
      if (navTarget.current !== routeYear) return;
      navTarget.current = undefined;
    }
    if (phase === "river" && routeYear !== null) void enter(routeYear, false);
    else if (phase === "room" && routeYear === null) leave(false);
    else if (phase === "room" && routeYear !== null && routeYear !== year) {
      river.current?.reveal(routeYear);
      setYear(routeYear);
    }
  }, [phase, routeYear, year, enter, leave]);

  // The numeral zoom. Runs before paint so the room never flashes in its final place.
  useLayoutEffect(() => {
    if (phase !== "entering" && phase !== "leaving") return;
    const roomEl = room.current;
    const riverEl = river.current?.element;
    const numeral = roomEl?.querySelector<HTMLElement>("[data-room-numeral]");
    if (!roomEl || !riverEl || !numeral || year === null) return;

    const chrome = roomEl.querySelectorAll("[data-room-chrome]");
    const rising = roomEl.querySelectorAll("[data-rise]");
    const reduced = prefersReducedMotion();

    if (phase === "entering") {
      const from = fromBox.current;
      const tl = gsap.timeline({
        defaults: { ease: EASE },
        onComplete: () => {
          busy.current = false;
          setPhase("room");
        },
      });
      if (reduced || !from) {
        tl.fromTo(roomEl, { opacity: 0 }, { opacity: 1, duration: DURATION.reduced }, 0).to(
          riverEl,
          { opacity: 0, duration: DURATION.reduced },
          0,
        );
      } else {
        gsap.set(numeral, { clearProps: "transform" });
        gsap.set(roomEl, { opacity: 1 });
        tl.fromTo(numeral, flight(numeral, from), { x: 0, y: 0, scale: 1, duration: DURATION.enter }, 0)
          .to(
            riverEl,
            { opacity: 0, scale: 1.04, transformOrigin: `${from.cx}px ${from.cy}px`, duration: DURATION.enter },
            0,
          )
          .fromTo(chrome, { opacity: 0 }, { opacity: 1, duration: 0.3 }, DURATION.enter * 0.6)
          .fromTo(
            rising,
            { opacity: 0, y: 24 },
            { opacity: 1, y: 0, duration: 0.5, stagger: DURATION.enterStagger },
            DURATION.enter,
          );
      }
      return () => {
        tl.kill();
      };
    }

    // Leaving: the reverse, landing on the same numeral in the river.
    lastLeft.current = year;
    const done = () => {
      setYear(null);
      setPhase("river");
    };
    const tl = gsap.timeline({ defaults: { ease: EASE }, onComplete: done });
    if (reduced) {
      tl.to(roomEl, { opacity: 0, duration: DURATION.reduced }, 0).fromTo(
        riverEl,
        { opacity: 0, scale: 1 },
        { opacity: 1, duration: DURATION.reduced },
        0,
      );
    } else {
      gsap.set(riverEl, { scale: 1 });
      const to = river.current!.numeralBox(year);
      tl.to([...chrome, ...rising], { opacity: 0, duration: 0.2 }, 0).fromTo(
        riverEl,
        { opacity: 0, scale: 1.04 },
        { opacity: 1, scale: 1, duration: DURATION.leave },
        0,
      );
      if (to) {
        gsap.set(riverEl, { transformOrigin: `${to.cx}px ${to.cy}px` });
        tl.to(numeral, { ...flight(numeral, to), duration: DURATION.leave }, 0);
      }
    }
    return () => {
      tl.kill();
    };
  }, [phase, year]);

  // Keyboard focus follows the move: into the room's numeral, or back onto the river's.
  useEffect(() => {
    if (phase === "room") room.current?.querySelector<HTMLElement>("[data-room-numeral]")?.focus({ preventScroll: true });
    if (phase === "river" && lastLeft.current !== null) {
      river.current?.focusNumeral(lastLeft.current);
      lastLeft.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "room") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, leave]);

  const onEnter = useCallback((y: number) => void enter(y), [enter]);

  return (
    <>
      <River
        ref={river}
        years={years}
        decades={decades}
        firstYear={firstYear}
        lastYear={lastYear}
        hiddenYear={phase === "river" ? null : year}
        lens={lens}
        thread={thread}
        threads={threads}
        covered={year !== null}
        onEnter={onEnter}
      />
      {thread && year === null && <ThreadPanel thread={thread} />}
      {year !== null && (
        <YearRoom
          ref={room}
          year={year}
          events={roomEvents}
          images={roomImages}
          news={year === lastYear ? news : null}
          lens={lens}
          loading={roomLoading}
          decades={decades}
          onLeave={() => leave()}
        />
      )}
    </>
  );
}
