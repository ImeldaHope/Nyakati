"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import gsap from "gsap";
import Lenis from "lenis";
import { ERAS, LENSES, eventMonth, eventYear, yearsBetween, type Lens, type Thread, type TimelineEvent, type View } from "@/lib/timeline";
import { decadeOf, loadDecade, peekDecade } from "@/lib/decades";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";

// Matches the breakpoint in globals.css where the river turns horizontal.
const HORIZONTAL = "(min-width: 760px)";

export type Zoom = "year" | "decade" | "century";
const ZOOMS: Zoom[] = ["year", "decade", "century"];
const ZOOM_LABEL: Record<Zoom, string> = { year: "Year", decade: "Decade", century: "Century" };

// Below this cell size the marks for a year stack in one column, so busy years read as tall bars.
const COLUMN_MARKS_BELOW = 60;
// The era bar along the very top of the river.
const ERA_BAR = 26;
// Space between neighbouring numerals in the year view, as a share of the font size, so the
// years read as one band passing by rather than one numeral at a time.
const BAND_GAP = 0.2;
// Vertical river (phones): years stack with this much space between their digits.
const STACK = 0.92;
// Eras whose emptiness needs explaining (the plan: "let those decades be sparse and say why").
const SPARSE_NOTE: Record<string, string> = {
  protectorate: "Few dated sources yet; early records are mostly colonial",
  colony: "Few dated sources yet; early records are mostly colonial",
};

/** Where a numeral is drawn, in viewport pixels. The year room's zoom starts and ends here. */
export interface NumeralBox {
  left: number;
  width: number;
  baseline: number;
  top: number;
  height: number;
  cx: number;
  cy: number;
}

export interface RiverHandle {
  element: HTMLDivElement | null;
  readonly zoom: Zoom;
  numeralBox(year: number): NumeralBox | null;
  /** Scroll a year into the middle of the river if its numeral is not already on screen. */
  reveal(year: number): void;
  /** The first-visit drift that comes to rest on a year. */
  arrive(year: number): void;
  focusNumeral(year: number): void;
  /** Animate to a zoom level, ending with `year` (or the current middle year) centred. */
  zoomTo(level: Zoom, year?: number): Promise<void>;
}

interface Mark {
  id: string;
  title: string;
  date: string;
  lens: Lens;
  slot: number; // 1–12 by month, 13 for year-only events
  stack: number; // position within its month
  column: number; // position within its year
}

interface Props {
  ref: Ref<RiverHandle>;
  years: Record<string, number>;
  decades: number[];
  firstYear: number;
  lastYear: number;
  hiddenYear: number | null;
  /** The room's filter. All dims nothing; a lens dims the others' marks to 15%. */
  lens: View;
  /** A thread to draw as a brass line through its events; everything else dims. */
  thread: Thread | null;
  threads: Thread[];
  covered: boolean;
  onEnter(year: number): void;
}

interface Geometry {
  horizontal: boolean;
  w: number;
  h: number;
  extent: number; // viewport length along the river
  cell: number;
  pad: number;
  font: number;
  yearCell: number;
  gutter: number;
  track: number; // the strip's track: y on the horizontal river, x on the vertical one
}

/** Font size of a numeral in the year view: 32% of the height (the plan: 30–40%). */
function yearFont(horizontal: boolean, w: number, h: number, ratio: number): number {
  return horizontal ? 0.32 * h : Math.min((0.6 * w) / ratio, 0.2 * h);
}

/** Cell size per zoom level. `ratio` is the widest numeral's width as a share of its font size. */
function cellFor(level: Zoom, horizontal: boolean, w: number, h: number, n: number, ratio: number): number {
  const font = yearFont(horizontal, w, h, ratio);
  if (level === "year") return horizontal ? font * (ratio + BAND_GAP) : font * STACK;
  if (level === "decade") return (horizontal ? w : h - 90) / 10.5;
  return Math.max(2, horizontal ? (w - 200) / n : (h - 200) / n);
}

function marksFor(events: TimelineEvent[]): Map<number, Mark[]> {
  const byYear = new Map<number, Mark[]>();
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const year = eventYear(e);
    const slot = eventMonth(e) ?? 13;
    const list = byYear.get(year) ?? [];
    list.push({
      id: e.id,
      title: e.title,
      date: e.date,
      lens: e.lens,
      slot,
      stack: list.filter((m) => m.slot === slot).length,
      column: list.length,
    });
    byYear.set(year, list);
  }
  return byYear;
}

/** A lens's mark shape: square, circle, triangle or diamond, in a size-by-size box. */
function lensGlyph(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, size: number) {
  const h = size / 2;
  ctx.beginPath();
  if (shape === "circle") ctx.arc(x + h, y + h, h, 0, Math.PI * 2);
  else if (shape === "triangle") {
    ctx.moveTo(x + h, y);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x, y + size);
  } else if (shape === "diamond") {
    ctx.moveTo(x + h, y);
    ctx.lineTo(x + size, y + h);
    ctx.lineTo(x + h, y + size);
    ctx.lineTo(x, y + h);
  } else ctx.rect(x, y, size, size);
  ctx.closePath();
  ctx.fill();
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function River({
  ref,
  years: counts,
  decades,
  firstYear,
  lastYear,
  hiddenYear,
  lens,
  thread,
  threads,
  covered,
  onEnter,
}: Props) {
  const screen = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const jumpInput = useRef<HTMLInputElement>(null);
  const numerals = useRef(new Map<number, HTMLButtonElement>());

  const years = useMemo(() => yearsBetween(firstYear, lastYear), [firstYear, lastYear]);
  const [zoom, setZoom] = useState<Zoom>("year");
  const [tabYear, setTabYear] = useState(hiddenYear ?? lastYear);
  const [jump, setJump] = useState("");
  const [jumpError, setJumpError] = useState("");

  // Mutable drawing state, read by the canvas on every frame.
  const s = useRef({
    zoom: "year" as Zoom,
    cell: 0,
    hover: null as number | null,
    focus: null as { year: number; visible: boolean } | null,
    hidden: hiddenYear,
    focusLens: (lens === "all" ? "politics" : lens) as Lens,
    dim: lens === "all" ? 0 : 1, // 0 = every mark at full strength, 1 = other lenses at 15%
    marks: new Map<number, Map<number, Mark[]>>(), // decade -> year -> marks
    hits: [] as { x: number; y: number; w: number; h: number; mark: Mark }[],
    family: "Georgia, serif",
    ascent: 0.72, // digit height as a share of font size, measured once the font loads
    ratio: 2.35, // widest year's width as a share of font size, measured once the font loads
    lenis: null as Lenis | null,
    thread: null as { ids: Set<string>; events: Thread["events"] } | null,
    threadProgress: 0, // 0 → 1 as the brass line draws left to right
    // Resolves once the numeral font has loaded and the band has been spaced for it.
    ready: null as Promise<void> | null,
    settled: () => {},
    colors: {} as Record<string, string>,
    frame: 0,
    time: 0, // seconds, for the river's current
    looping: false, // the current is animating, so the loop draws every frame
    // Numerals pre-rendered at the current size: drawing a 300px glyph every frame is the costly part.
    sprites: new Map<string, HTMLCanvasElement>(),
    spriteFont: 0,
    widths: new Map<string, number>(),
    drift: null as gsap.core.Tween | null,
    dragged: false,
  });

  const horizontal = () => window.matchMedia(HORIZONTAL).matches;

  function geometry(): Geometry {
    const el = scroller.current!;
    const hz = horizontal();
    const w = el.clientWidth;
    const h = el.clientHeight;
    const extent = hz ? w : h;
    const ratio = s.current.ratio;
    const yearCell = cellFor("year", hz, w, h, years.length, ratio);
    const cell = s.current.cell || yearCell;
    const font = Math.min(hz ? cell / (ratio + BAND_GAP) : cell / STACK, yearFont(hz, w, h, ratio));
    const gutter = hz ? 32 : 16;
    return {
      horizontal: hz,
      w,
      h,
      extent,
      cell,
      pad: extent / 2 - cell / 2,
      font,
      yearCell,
      gutter,
      track: hz ? 0.8 * h : gutter + ratio * font + 14,
    };
  }

  const position = () => (horizontal() ? scroller.current!.scrollLeft : scroller.current!.scrollTop);

  function numeralFont(font: number) {
    return `800 ${font}px ${s.current.family}`;
  }

  function textWidth(year: number, font: number): number {
    const key = `${year}|${font.toFixed(2)}`;
    let width = s.current.widths.get(key);
    if (width === undefined) {
      const ctx = canvas.current!.getContext("2d")!;
      ctx.font = numeralFont(font);
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${-0.03 * font}px`;
      width = ctx.measureText(String(year)).width;
      if (s.current.widths.size > 2000) s.current.widths.clear();
      s.current.widths.set(key, width);
    }
    return width;
  }

  function numeralBox(year: number, g: Geometry = geometry(), pos: number = position()): NumeralBox | null {
    if (!canvas.current || !scroller.current) return null;
    const i = year - firstYear;
    const start = g.pad + i * g.cell - pos;
    const width = textWidth(year, g.font);
    const height = s.current.ascent * g.font;
    const left = g.horizontal ? start + g.cell / 2 - width / 2 : g.gutter;
    const baseline = g.horizontal ? 0.55 * g.h : start + g.cell / 2 + height / 2;
    return { left, width, baseline, top: baseline - height, height, cx: left + width / 2, cy: baseline - height / 2 };
  }

  // A numeral rendered once into its own canvas, drawn from (left - 0.1em, baseline - 1em).
  function numeralSprite(year: number, font: number, colour: string, dpr: number): HTMLCanvasElement {
    if (Math.abs(font - s.current.spriteFont) > 0.01) {
      s.current.sprites.clear();
      s.current.spriteFont = font;
    }
    const key = `${year}|${colour}|${dpr}`;
    let sprite = s.current.sprites.get(key);
    if (!sprite) {
      sprite = document.createElement("canvas");
      const width = textWidth(year, font);
      sprite.width = Math.ceil((width + font * 0.3) * dpr);
      sprite.height = Math.ceil(font * 1.3 * dpr);
      const sctx = sprite.getContext("2d")!;
      sctx.scale(dpr, dpr);
      sctx.font = numeralFont(font);
      if ("letterSpacing" in sctx) sctx.letterSpacing = `${-0.03 * font}px`;
      sctx.fillStyle = colour;
      sctx.fillText(String(year), font * 0.1, font);
      s.current.sprites.set(key, sprite);
    }
    return sprite;
  }

  // The banks: two slow sine waves, in river coordinates, so the river meanders as it passes.
  function bank(u: number, seed: number, amplitude: number) {
    return amplitude * (Math.sin(u / 430 + seed) + 0.6 * Math.sin(u / 157 + seed * 2.3));
  }

  function drawRiver(ctx: CanvasRenderingContext2D, g: Geometry, pos: number, along: (i: number) => number) {
    const c = s.current.colors;
    const start = along(0);
    const end = along(years.length);
    const a0 = Math.max(-40, start - 120);
    const a1 = Math.min(g.extent + 40, end + 160);
    if (a1 <= a0) return;
    const amp = g.horizontal ? Math.min(16, g.h * 0.018) : 10;
    // Near and far banks, across the river: y on the horizontal river, x on the vertical one.
    // On phones the river runs down the screen with a strip of ground showing on either bank.
    const near = (a: number) => (g.horizontal ? 0.25 * g.h : 30) + bank(a + pos, 0, amp);
    const far = (a: number) => (g.horizontal ? 0.88 * g.h : g.w - 30) + bank(a + pos, 1.9, amp);
    const pt = (a: number, cross: number): [number, number] => (g.horizontal ? [a, cross] : [cross, a]);
    const STEP = 8;

    const outline = () => {
      ctx.beginPath();
      for (let a = a0; a <= a1; a += STEP) ctx.lineTo(...pt(a, near(a)));
      for (let a = a1; a >= a0; a -= STEP) ctx.lineTo(...pt(a, far(a)));
      ctx.closePath();
    };

    ctx.save();
    ctx.globalAlpha = 1;
    outline();
    ctx.fillStyle = g.horizontal ? "rgba(239, 232, 218, 0.045)" : "rgba(239, 232, 218, 0.065)";
    ctx.fill();
    ctx.clip();

    // Each era tints its stretch of water; alternate eras run a shade lighter.
    ERAS.forEach((era, k) => {
      if (k % 2 === 0) return;
      const ea = along(era.start - firstYear);
      const eb = along(Math.min(era.end ?? lastYear, lastYear) - firstYear + 1);
      if (eb < 0 || ea > g.extent) return;
      ctx.fillStyle = "rgba(239, 232, 218, 0.035)";
      g.horizontal ? ctx.fillRect(ea, 0, eb - ea, g.h) : ctx.fillRect(0, ea, g.w, eb - ea);
    });

    // The current: faint dashed lines that follow the banks and drift toward today.
    const t = s.current.time;
    ctx.lineWidth = 1;
    for (let j = 0; j < 9; j++) {
      const f = 0.1 + j * 0.1;
      const dash = 24 + ((j * 13) % 40);
      const gap = 34 + ((j * 29) % 80);
      ctx.setLineDash([dash, gap]);
      ctx.lineDashOffset = a0 + pos - t * (14 + (j % 4) * 5);
      ctx.strokeStyle = `rgba(239, 232, 218, ${0.05 + (j % 3) * 0.025})`;
      ctx.beginPath();
      for (let a = a0; a <= a1; a += STEP) {
        const across = near(a) + f * (far(a) - near(a)) + 3 * Math.sin((a + pos) / 90 + j * 1.3);
        ctx.lineTo(...pt(a, across));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // The banks.
    ctx.strokeStyle = "rgba(239, 232, 218, 0.18)";
    ctx.lineWidth = 1;
    for (const edge of [near, far]) {
      ctx.beginPath();
      for (let a = Math.max(a0, start); a <= Math.min(a1, end); a += STEP) ctx.lineTo(...pt(a, edge(a)));
      ctx.stroke();
    }

    // The river rises out of the dark before 1895.
    const rise = g.horizontal
      ? ctx.createLinearGradient(start - 120, 0, start, 0)
      : ctx.createLinearGradient(0, start - 120, 0, start);
    rise.addColorStop(0, c.ground);
    rise.addColorStop(1, "rgba(20, 17, 15, 0)");
    ctx.fillStyle = rise;
    g.horizontal ? ctx.fillRect(start - 120, ERA_BAR, 120, g.h - ERA_BAR) : ctx.fillRect(0, start - 120, g.w, 120);
  }

  function scheduleDraw() {
    if (!s.current.looping && !s.current.frame) s.current.frame = requestAnimationFrame(draw);
  }

  function draw() {
    s.current.frame = 0;
    const el = scroller.current;
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!el || !cv || !ctx) return;
    const g = geometry();
    // Capped at 2: on a 3× phone a full-screen canvas would cost 9× the pixels for no visible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(g.w * dpr) || cv.height !== Math.round(g.h * dpr)) {
      cv.width = Math.round(g.w * dpr);
      cv.height = Math.round(g.h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);
    const c = s.current.colors;
    const pos = position();
    const along = (i: number) => g.pad + i * g.cell - pos; // start of year i on screen
    const iMin = Math.max(0, Math.floor((pos - g.pad) / g.cell) - 1);
    const iMax = Math.min(years.length - 1, Math.ceil((pos - g.pad + g.extent) / g.cell) + 1);

    // Eras: tinted bands down the river, and the era bar along the very top with each era's
    // name pinned in view. The sparse early eras say why on the bar itself.
    const centreYear = firstYear + Math.round(pos / g.cell);
    ERAS.forEach((era, k) => {
      const a = along(era.start - firstYear);
      const b = along(Math.min(era.end ?? lastYear, lastYear) - firstYear + 1);
      const isLast = k === ERAS.length - 1;
      ctx.globalAlpha = 1;
      if (g.horizontal) {
        if (b < 0 || a > g.extent) return;
        ctx.fillStyle = k % 2 === 1 ? "rgba(239, 232, 218, 0.12)" : "rgba(239, 232, 218, 0.06)";
        ctx.fillRect(a, 0, b - a, ERA_BAR);
        ctx.fillStyle = c.rule;
        ctx.fillRect(Math.round(a), 0, 1, ERA_BAR);
      } else if (b < 0 || a > g.extent) {
        return;
      }

      ctx.font = `400 10px ${c.mono}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0.9px";
      ctx.fillStyle = c.paperDim;
      ctx.textBaseline = "middle";
      const room = (g.horizontal ? b - a : g.w) - 2 * g.gutter;
      const note = SPARSE_NOTE[era.id];
      const full = `${era.name.toUpperCase()}  ${era.start}–${era.end ?? ""}`;
      const label =
        [note && `${full}  ·  ${note.toUpperCase()}`, full, era.name.toUpperCase(), era.short.toUpperCase()]
          .filter((t): t is string => Boolean(t))
          .find((t) => ctx.measureText(t).width <= room) ?? era.short.toUpperCase();
      const width = ctx.measureText(label).width;
      if (g.horizontal) {
        let x = Math.max(a + g.gutter, Math.min(g.gutter, b - width - g.gutter));
        // The last era has nothing after it, so its label may slide left to stay on screen.
        if (isLast) x = Math.max(g.gutter, Math.min(x, g.extent - width - g.gutter));
        ctx.save();
        ctx.beginPath();
        ctx.rect(a, 0, isLast ? g.extent - a : b - a, ERA_BAR);
        ctx.clip();
        ctx.textAlign = "left";
        ctx.fillText(label, x, ERA_BAR / 2 + 1);
        ctx.restore();
      } else if (centreYear >= era.start && centreYear <= (era.end ?? lastYear)) {
        // On the vertical river the bar names the era of the year in the middle of the screen.
        ctx.fillStyle = k % 2 === 1 ? "rgba(239, 232, 218, 0.12)" : "rgba(239, 232, 218, 0.06)";
        ctx.fillRect(0, 0, g.w, ERA_BAR);
        ctx.fillStyle = c.paperDim;
        ctx.textAlign = "left";
        ctx.fillText(label, g.gutter, ERA_BAR / 2 + 1);
      }
      ctx.textBaseline = "alphabetic";
    });
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    // The river itself: a band of water from 1895 to today with gently meandering banks,
    // tinted by era, its current drifting from the past toward the present. The banks are
    // computed along the river, so they slide with the years as you scroll.
    drawRiver(ctx, g, pos, along);

    // The strip's track: one line the length of the river with a tick at every year and a
    // longer one at every decade, so the band reads as continuous even where it is empty.
    ctx.globalAlpha = 1;
    const riverStart = Math.max(0, along(0));
    const riverEnd = Math.min(g.extent, along(years.length));
    // The riverbed the marks rest on.
    ctx.fillStyle = "rgba(239, 232, 218, 0.16)";
    if (g.horizontal) ctx.fillRect(riverStart, Math.round(g.track), riverEnd - riverStart, 1);
    else ctx.fillRect(Math.round(g.track), riverStart, 1, riverEnd - riverStart);
    const tickEvery = g.cell >= 30 ? 1 : 5;
    ctx.font = `400 10px ${c.mono}`;
    for (let i = iMin; i <= iMax; i++) {
      const year = firstYear + i;
      if (year % tickEvery !== 0) continue;
      const at = Math.round(along(i));
      const decade = year % 10 === 0;
      ctx.fillStyle = decade ? "rgba(239, 232, 218, 0.4)" : "rgba(239, 232, 218, 0.18)";
      if (g.horizontal) {
        ctx.fillRect(at, g.track + 1, 1, decade ? 10 : 5);
        if (decade && g.cell * 10 > 80) {
          ctx.fillStyle = c.paperDim;
          ctx.textAlign = "left";
          ctx.fillText(String(year), at + 5, g.track + 14);
        }
      } else {
        ctx.fillRect(g.track - (decade ? 10 : 5), at, decade ? 10 : 5, 1);
      }
    }

    // Marks: one mark per event, coloured by lens and shaped by lens too (the plan: a lens is
    // never shown by colour alone), moving slightly faster than the numerals. Zoomed out, they
    // are 2px bars stacked in one column per year, so busy years stand out.
    const hits: typeof s.current.hits = [];
    const columns = g.cell < COLUMN_MARKS_BELOW;
    for (let decade = decadeOf(firstYear + iMin); decade <= decadeOf(firstYear + iMax); decade += 10) {
      if (!decades.includes(decade) || s.current.marks.has(decade)) continue;
      const data = peekDecade(decade);
      if (data) s.current.marks.set(decade, marksFor(data.events));
      else loadDecade(decade).then(scheduleDraw);
    }
    const GLYPH = 6;
    // Zoomed out, a busy year's column must not climb into the year labels: shrink the step
    // so the busiest year on screen just reaches them.
    let busiest = 1;
    for (let i = iMin; i <= iMax; i++) {
      const y = firstYear + i;
      busiest = Math.max(busiest, s.current.marks.get(decadeOf(y))?.get(y)?.length ?? 0);
    }
    const columnStep = Math.max(1.5, Math.min(4, (g.track - 0.55 * g.h - 16) / busiest));
    const drawn = new Map<string, [number, number]>(); // event id -> centre of its mark this frame
    const th = s.current.thread;
    for (let i = iMin; i <= iMax; i++) {
      const year = firstYear + i;
      const marks = s.current.marks.get(decadeOf(year))?.get(year);
      if (!marks) continue;
      const start = along(i);
      const drift = (i * g.cell - pos) * 0.08 * (g.cell / g.yearCell);
      for (const m of marks) {
        ctx.globalAlpha = th
          ? th.ids.has(m.id) ? 1 : 0.15
          : m.lens === s.current.focusLens ? 1 : 1 - 0.85 * s.current.dim;
        ctx.fillStyle = c[`lens-${m.lens}`] ?? c.rule;
        let x: number, y: number, mw: number, mh: number;
        if (columns) {
          if (g.horizontal) {
            mw = Math.max(1.5, Math.min(g.cell * 0.6, 10));
            mh = 2;
            x = start + g.cell / 2 - mw / 2 + drift;
            y = g.track - 3 - m.column * columnStep - mh;
          } else {
            mw = 2;
            mh = Math.max(1.5, Math.min(g.cell * 0.6, 8));
            x = g.gutter + 56 + m.column * 4;
            y = start + g.cell / 2 - mh / 2 + drift;
          }
          ctx.fillRect(x, y, mw, mh);
        } else {
          // Placed by month across the year's cell, stacked upward from the track.
          if (g.horizontal) {
            const left = start + 0.1 * g.cell + drift;
            const span = 0.8 * g.cell;
            x = left + ((m.slot - 0.5) / 13) * span - GLYPH / 2;
            y = g.track - 4 - (m.stack + 1) * (GLYPH + 2);
          } else {
            const left = g.track + 10;
            const span = g.w - g.gutter - left;
            x = left + ((m.slot - 0.5) / 13) * span - GLYPH / 2;
            y = start + 0.82 * g.cell + drift - (m.stack + 1) * (GLYPH + 2);
          }
          mw = mh = GLYPH;
          lensGlyph(ctx, LENSES[m.lens].shape, x, y, GLYPH);
        }
        hits.push({ x: x - 3, y: y - 3, w: mw + 6, h: mh + 6, mark: m });
        drawn.set(m.id, [x + mw / 2, y + mh / 2]);
      }
    }
    s.current.hits = hits;

    // A thread: a brass line through its events in date order, drawn left to right (or top to
    // bottom on phones) over 1.2 s. Events off screen are placed by their year.
    if (th && th.events.length > 0 && s.current.threadProgress > 0) {
      // One point per year, at the outermost of that year's thread marks, so the line reads as a
      // path through time rather than zigzagging up and down a busy year's column.
      const byYear = new Map<number, [number, number][]>();
      for (const e of th.events) {
        const year = Number(e.date.slice(0, 4));
        const mid = along(year - firstYear) + g.cell / 2;
        const at = drawn.get(e.id) ?? (g.horizontal ? [mid, g.track - 24] : [g.track + 24, mid]);
        byYear.set(year, [...(byYear.get(year) ?? []), at as [number, number]]);
      }
      const points = [...byYear.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, pts]): [number, number] =>
          g.horizontal
            ? [pts.reduce((t, p) => t + p[0], 0) / pts.length, Math.min(...pts.map((p) => p[1]))]
            : [Math.max(...pts.map((p) => p[0])), pts.reduce((t, p) => t + p[1], 0) / pts.length],
        );
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      const reach = s.current.threadProgress * g.extent;
      g.horizontal ? ctx.rect(0, 0, reach, g.h) : ctx.rect(0, 0, g.w, reach);
      ctx.clip();
      ctx.strokeStyle = c.brass;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      points.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.fillStyle = c.brass;
      for (const [x, y] of points) {
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Numerals, fading to decade labels and ticks as the river zooms out.
    const numeralAlpha = Math.max(0, Math.min(1, (g.font - 20) / 12));
    const focus = s.current.focus;
    if (numeralAlpha > 0) {
      ctx.globalAlpha = numeralAlpha;
      for (let i = iMin; i <= iMax; i++) {
        const year = firstYear + i;
        if (year === s.current.hidden) continue;
        const box = numeralBox(year, g, pos)!;
        const colour = year === lastYear ? c.murram : year === s.current.hover ? "#ffffff" : c.paper;
        const sprite = numeralSprite(year, g.font, colour, dpr);
        ctx.drawImage(sprite, box.left - g.font * 0.1, box.baseline - g.font, sprite.width / dpr, sprite.height / dpr);
      }
    }
    if (numeralAlpha < 1) {
      ctx.globalAlpha = 1 - numeralAlpha;
      ctx.font = `400 12px ${c.mono}`;
      for (let i = iMin; i <= iMax; i++) {
        const year = firstYear + i;
        const mid = along(i) + g.cell / 2;
        const labelled = year % 10 === 0 || year === lastYear;
        ctx.fillStyle = labelled ? c.paperDim : c.rule;
        if (g.horizontal) {
          ctx.fillRect(Math.round(mid), 0.55 * g.h - (labelled ? 12 : 6), 1, labelled ? 12 : 6);
          if (labelled) {
            ctx.textAlign = "center";
            ctx.fillStyle = year === lastYear ? c.murramInk : c.paper;
            ctx.fillText(String(year), mid, 0.55 * g.h - 20);
          }
        } else {
          ctx.fillRect(g.gutter, Math.round(mid), labelled ? 10 : 5, 1);
          if (labelled) {
            ctx.textAlign = "left";
            ctx.fillStyle = year === lastYear ? c.murramInk : c.paper;
            ctx.fillText(String(year), g.gutter + 14, mid + 4);
          }
        }
      }
    }

    // Keyboard focus ring.
    if (focus?.visible && focus.year !== s.current.hidden) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.murramInk;
      ctx.lineWidth = 2;
      if (numeralAlpha > 0.5) {
        const box = numeralBox(focus.year, g, pos)!;
        ctx.strokeRect(box.left - 12, box.top - 12, box.width + 24, box.height + 24);
      } else {
        const mid = along(focus.year - firstYear) + g.cell / 2;
        g.horizontal ? ctx.strokeRect(mid - 14, 0.55 * g.h - 36, 28, 40) : ctx.strokeRect(g.gutter - 6, mid - 10, 60, 20);
      }
    }

    // The river ends at today with a soft edge.
    const end = along(years.length);
    if (end < g.extent) {
      ctx.globalAlpha = 1;
      // The fade starts after the last year, so the water runs out softly past today, not over 2026.
      const fade = 150;
      const grad = g.horizontal
        ? ctx.createLinearGradient(end, 0, end + fade, 0)
        : ctx.createLinearGradient(0, end, 0, end + fade);
      grad.addColorStop(0, "rgba(20, 17, 15, 0)");
      grad.addColorStop(1, c.ground);
      ctx.fillStyle = grad;
      g.horizontal ? ctx.fillRect(end, 0, g.extent, g.h) : ctx.fillRect(0, end, g.w, g.extent);
      ctx.fillStyle = c.paperDim;
      ctx.font = `400 11px ${c.mono}`;
      ctx.textAlign = "left";
      g.horizontal ? ctx.fillText("TODAY", end + 16, g.track + 4) : ctx.fillText("TODAY", g.gutter, end + 28);
    }
    ctx.globalAlpha = 1;
  }

  // Resize the scrollable length for a cell size and keep `centre` (a fractional year index) in the middle.
  function applyCell(cell: number, centre: number) {
    const el = scroller.current;
    const sp = spacer.current;
    if (!el || !sp) return;
    s.current.cell = cell;
    const g = geometry();
    const length = 2 * g.pad + years.length * cell;
    sp.style.setProperty("--cell", `${cell}px`);
    sp.style.setProperty("--pad", `${g.pad}px`);
    if (g.horizontal) {
      sp.style.width = `${length}px`;
      sp.style.height = "100%";
    } else {
      sp.style.height = `${length}px`;
      sp.style.width = "100%";
    }
    s.current.lenis?.resize();
    setScroll(centre * cell);
    scheduleDraw();
  }

  // Lenis gives the wheel the plan's smooth feel; touch and reduced motion stay native.
  function makeLenis() {
    s.current.lenis?.destroy();
    s.current.lenis = null;
    const el = scroller.current;
    if (!el || !spacer.current || prefersReducedMotion()) return;
    s.current.lenis = new Lenis({
      wrapper: el,
      content: spacer.current,
      orientation: horizontal() ? "horizontal" : "vertical",
      gestureOrientation: "both", // a vertical wheel moves the horizontal river
      smoothWheel: true,
      syncTouch: false,
      autoRaf: true,
    });
  }

  /** Jump the river to a scroll offset, through Lenis when it is running. */
  function setScroll(offset: number) {
    const el = scroller.current;
    if (!el) return;
    if (s.current.lenis) s.current.lenis.scrollTo(offset, { immediate: true, force: true });
    else if (horizontal()) el.scrollLeft = offset;
    else el.scrollTop = offset;
  }

  /** Glide to a scroll offset with the one ease-out curve. */
  function glideTo(offset: number, duration: number) {
    const el = scroller.current;
    if (!el) return;
    if (s.current.lenis) {
      s.current.lenis.scrollTo(offset, { duration, easing: (t: number) => 1 - Math.pow(1 - t, 4), force: true });
      return;
    }
    const prop = horizontal() ? "scrollLeft" : "scrollTop";
    s.current.drift?.kill();
    s.current.drift = gsap.to(el, { [prop]: offset, duration, ease: EASE });
  }

  const centreIndex = () => position() / (s.current.cell || 1);

  function scrollToYear(year: number, smooth: boolean) {
    const el = scroller.current;
    if (!el) return;
    s.current.drift?.kill();
    const offset = (year - firstYear) * s.current.cell;
    if (smooth && !prefersReducedMotion()) glideTo(offset, 0.8);
    else setScroll(offset);
  }

  function onScreen(year: number): boolean {
    const box = numeralBox(year);
    const el = scroller.current;
    if (!box || !el) return false;
    return box.left >= 0 && box.top >= 0 && box.left + box.width <= el.clientWidth && box.baseline <= el.clientHeight;
  }

  function zoomTo(level: Zoom, year?: number): Promise<void> {
    const el = scroller.current;
    if (!el) return Promise.resolve();
    s.current.drift?.kill();
    const g = geometry();
    const target = cellFor(level, g.horizontal, g.w, g.h, years.length, s.current.ratio);
    const from = { cell: s.current.cell, centre: centreIndex() };
    // The century view shows the whole river, so it always centres on the middle.
    const centre = level === "century" ? (years.length - 1) / 2 : year === undefined ? from.centre : year - firstYear;
    const to = { cell: target, centre };
    s.current.zoom = level;
    setZoom(level);
    if (prefersReducedMotion() || Math.abs(from.cell - to.cell) < 0.5) {
      applyCell(to.cell, to.centre);
      return Promise.resolve();
    }
    const state = { ...from };
    return new Promise((resolve) => {
      gsap.to(state, {
        cell: to.cell,
        centre: to.centre,
        duration: 0.5,
        ease: EASE,
        onUpdate: () => applyCell(state.cell, state.centre),
        onComplete: () => resolve(),
      });
    });
  }

  function step(direction: 1 | -1, year?: number) {
    const next = ZOOMS[ZOOMS.indexOf(s.current.zoom) + direction];
    if (next) void zoomTo(next, year);
  }

  useImperativeHandle(ref, () => ({
    get element() {
      return screen.current;
    },
    get zoom() {
      return s.current.zoom;
    },
    numeralBox,
    reveal(year) {
      setTabYear(year);
      if (!onScreen(year)) scrollToYear(year, false);
    },
    arrive(year) {
      const el = scroller.current;
      setTabYear(year);
      if (!el) return;
      // Spacing the band for the real font moves the river, so drift only once that is done.
      if (s.current.ready) {
        const ready = s.current.ready;
        s.current.ready = null;
        void ready.then(() => this.arrive(year));
        return;
      }
      if (prefersReducedMotion()) return scrollToYear(year, false);
      const cell = s.current.cell;
      s.current.drift?.kill();
      setScroll(Math.max(0, year - 6 - firstYear) * cell);
      glideTo((year - firstYear) * cell, DURATION.arrival);
    },
    focusNumeral(year) {
      setTabYear(year);
      numerals.current.get(year)?.focus({ preventScroll: true });
    },
    zoomTo,
  }));

  // Setup: colours and the numeral font, the first layout, and redraws on scroll and resize.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const css = (n: string) => cssVar(n);
    s.current.colors = {
      ground: css("--ground"),
      paper: css("--paper"),
      paperDim: css("--paper-dim"),
      murram: css("--murram"),
      murramInk: css("--murram-ink"),
      rule: "rgba(239, 232, 218, 0.14)",
      mono: css("--font-geist-mono") || "monospace",
      "lens-politics": css("--murram"),
      "lens-news": css("--slate"),
      "lens-culture": css("--acacia"),
      "lens-places": css("--brass"),
      brass: css("--brass"),
    };
    s.current.family = css("--font-fraunces") || "Georgia, serif";
    s.current.ready = new Promise((resolve) => (s.current.settled = resolve));
    const g0 = geometry();
    applyCell(cellFor("year", g0.horizontal, g0.w, g0.h, years.length, s.current.ratio), (hiddenYear ?? lastYear) - firstYear);
    makeLenis();
    // Load just the Fraunces face: the stack's fallback face may not exist on this system.
    const primary = s.current.family.split(",")[0];
    document.fonts
      .load(`800 100px ${primary}`)
      .catch(() => [])
      .then(() => {
        const ctx = canvas.current?.getContext("2d");
        const centre = centreIndex();
        if (ctx) {
          ctx.font = numeralFont(100);
          if ("letterSpacing" in ctx) ctx.letterSpacing = "-3px";
          const m = ctx.measureText("1963");
          if (m.actualBoundingBoxAscent) s.current.ascent = m.actualBoundingBoxAscent / 100;
          // The band's spacing comes from the widest year, so no two numerals ever touch.
          s.current.ratio = Math.max(...years.map((y) => ctx.measureText(String(y)).width)) / 100;
        }
        // Anything measured or rendered before the font arrived used the fallback.
        s.current.widths.clear();
        s.current.sprites.clear();
        const g = geometry();
        applyCell(cellFor(s.current.zoom, g.horizontal, g.w, g.h, years.length, s.current.ratio), centre);
        s.current.settled();
      });

    let lastHorizontal = horizontal();
    let lastSize = `${el.clientWidth}x${el.clientHeight}`;
    // The Tab stop follows the middle year, but only once scrolling pauses: updating it on every
    // frame re-renders all the year buttons and drops frames.
    let settle = 0;
    const onScroll = () => {
      scheduleDraw();
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        const year = Math.min(lastYear, Math.max(firstYear, firstYear + Math.round(centreIndex())));
        if (!el.contains(document.activeElement)) setTabYear(year);
      }, 150);
    };
    // Cells are sized from the viewport, so a resize or rotation keeps the same year in the middle.
    const onResize = () => {
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size === lastSize) return;
      const centre = lastHorizontal === horizontal() ? centreIndex() : position() / (s.current.cell || 1);
      lastSize = size;
      lastHorizontal = horizontal();
      const g = geometry();
      if (s.current.lenis && s.current.lenis.options.orientation !== (g.horizontal ? "horizontal" : "vertical")) makeLenis();
      applyCell(cellFor(s.current.zoom, g.horizontal, g.w, g.h, years.length, s.current.ratio), centre);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      clearTimeout(settle);
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(s.current.frame);
      s.current.frame = 0;
      s.current.lenis?.destroy();
      s.current.lenis = null;
    };
    // Mount only; later changes go through applyCell and scheduleDraw.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    s.current.hidden = hiddenYear;
    scheduleDraw();
  }, [hiddenYear]); // eslint-disable-line react-hooks/exhaustive-deps

  // The current flows while the river is on screen; it stands still under reduced motion,
  // and pauses while a year room covers the river.
  useEffect(() => {
    if (covered || prefersReducedMotion()) return;
    let id = 0;
    s.current.looping = true;
    const flow = (now: number) => {
      s.current.time = now / 1000;
      s.current.frame = 0;
      draw();
      id = requestAnimationFrame(flow);
    };
    id = requestAnimationFrame(flow);
    return () => {
      cancelAnimationFrame(id);
      s.current.looping = false;
      scheduleDraw();
    };
  }, [covered]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Type a year": a digit typed anywhere on the river starts the year field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (covered || e.ctrlKey || e.metaKey || e.altKey || !/^\d$/.test(e.key)) return;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      setJump(e.key);
      setJumpError("");
      jumpInput.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [covered]);

  // Showing a thread: the century view, then the brass line drawing through it in 1.2 s.
  useEffect(() => {
    s.current.thread = thread ? { ids: new Set(thread.events.map((e) => e.id)), events: thread.events } : null;
    s.current.threadProgress = 0;
    scheduleDraw();
    if (!thread) return;
    let tween: gsap.core.Tween | null = null;
    void zoomTo("century").then(() => {
      if (prefersReducedMotion()) {
        s.current.threadProgress = 1;
        scheduleDraw();
        return;
      }
      tween = gsap.to(s.current, { threadProgress: 1, duration: 1.2, ease: EASE, onUpdate: scheduleDraw });
    });
    return () => {
      tween?.kill();
    };
  }, [thread]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching lens fades the other lenses' marks to 15% (or back), over 300 ms.
  useEffect(() => {
    if (lens !== "all") s.current.focusLens = lens;
    const target = lens === "all" ? 0 : 1;
    if (prefersReducedMotion()) {
      s.current.dim = target;
      scheduleDraw();
      return;
    }
    const tween = gsap.to(s.current, { dim: target, duration: DURATION.lens, ease: EASE, onUpdate: scheduleDraw });
    return () => {
      tween.kill();
    };
  }, [lens]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer: the wheel scrolls through time sideways (ctrl+wheel and pinch zoom), the mouse drags,
  // a hover shows a mark's title, and a click zooms in or enters the year under it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const stopDrift = () => s.current.drift?.kill();
    let lastZoomStep = 0;

    const onWheel = (e: WheelEvent) => {
      stopDrift();
      if (e.ctrlKey) {
        e.preventDefault();
        const now = performance.now();
        if (Math.abs(e.deltaY) > 4 && now - lastZoomStep > 450) {
          lastZoomStep = now;
          step(e.deltaY > 0 ? 1 : -1, yearAt(e.clientX, e.clientY) ?? undefined);
        }
        return;
      }
      // Lenis maps the wheel onto the river; without it (reduced motion), do it here.
      if (s.current.lenis || !horizontal() || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    };

    let startX = 0;
    let startScroll = 0;
    let pointer: number | null = null;
    const onDown = (e: PointerEvent) => {
      stopDrift();
      s.current.dragged = false;
      if (e.pointerType !== "mouse" || e.button !== 0 || !horizontal()) return;
      pointer = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === pointer) {
        const dx = e.clientX - startX;
        if (!s.current.dragged && Math.abs(dx) > 4) {
          s.current.dragged = true;
          el.setPointerCapture(e.pointerId);
          el.dataset.dragging = "";
        }
        if (s.current.dragged) {
          setScroll(startScroll - dx);
          return;
        }
      }
      hover(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      delete el.dataset.dragging;
    };
    const onLeave = () => hover(-1, -1);
    const onClick = (e: MouseEvent) => {
      if (s.current.dragged) {
        s.current.dragged = false;
        return;
      }
      const year = yearAt(e.clientX, e.clientY);
      if (year === null) return;
      if (s.current.zoom === "century") void zoomTo("decade", year);
      else if (!overNumeral(year, e.clientX, e.clientY)) return;
      else if (s.current.zoom === "decade") void zoomTo("year", year);
      else onEnter(year);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("click", onClick);
    el.addEventListener("touchstart", stopDrift, { passive: true });
    window.addEventListener("keydown", stopDrift);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("click", onClick);
      el.removeEventListener("touchstart", stopDrift);
      window.removeEventListener("keydown", stopDrift);
    };
  }, [onEnter]); // eslint-disable-line react-hooks/exhaustive-deps

  function yearAt(clientX: number, clientY: number): number | null {
    const el = scroller.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const g = geometry();
    const coord = g.horizontal ? clientX - r.left : clientY - r.top;
    const i = Math.floor((coord + position() - g.pad) / g.cell);
    return i >= 0 && i < years.length ? firstYear + i : null;
  }

  function overNumeral(year: number, clientX: number, clientY: number): boolean {
    const box = numeralBox(year);
    const r = scroller.current!.getBoundingClientRect();
    if (!box) return false;
    const x = clientX - r.left;
    const y = clientY - r.top;
    return x >= box.left - 16 && x <= box.left + box.width + 16 && y >= box.top - 16 && y <= box.baseline + 16;
  }

  function hover(clientX: number, clientY: number) {
    const el = scroller.current;
    const t = tip.current;
    if (!el || !t) return;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const hit = s.current.hits.find((m) => x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h);
    if (hit) {
      t.textContent = `${hit.mark.title} · ${hit.mark.date.slice(0, 4)} · ${LENSES[hit.mark.lens].label}`;
      t.style.transform = `translate(${Math.min(x + 12, el.clientWidth - 260)}px, ${y - 36}px)`;
      t.dataset.show = "";
    } else {
      delete t.dataset.show;
    }
    const year = yearAt(clientX, clientY);
    const over =
      year !== null && (s.current.zoom === "century" || overNumeral(year, clientX, clientY)) ? year : null;
    if (over !== null || hit) el.dataset.pointing = "";
    else delete el.dataset.pointing;
    if (over !== s.current.hover) {
      s.current.hover = over;
      scheduleDraw();
    }
  }

  function moveFocus(year: number) {
    const y = Math.min(lastYear, Math.max(firstYear, year));
    setTabYear(y);
    numerals.current.get(y)?.focus({ preventScroll: true });
    scrollToYear(y, true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const current = Number((e.target as HTMLElement).dataset.year);
    if (!current) return;
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      PageDown: current + 10,
      PageUp: current - 10,
      Home: firstYear,
      End: lastYear,
    };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(moves[e.key]);
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      step(-1, current);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      step(1, current);
    }
  }

  function goTo(value: string) {
    const y = Number(value.trim());
    if (!Number.isInteger(y) || y < firstYear || y > lastYear) {
      setJumpError(`Type a year from ${firstYear} to ${lastYear}.`);
      return;
    }
    setJumpError("");
    setJump("");
    moveFocus(y);
  }

  function onJump(e: React.FormEvent) {
    e.preventDefault();
    goTo(jump);
  }

  return (
    <div ref={screen} className="river-screen" inert={covered} data-covered={covered ? "" : undefined}>
      <canvas ref={canvas} className="river-canvas" aria-hidden="true" />
      <div ref={scroller} className="river" aria-label={`Years ${firstYear} to ${lastYear}`} role="region">
        <div ref={spacer} className="river-spacer">
          {/* The canvas draws the years; these buttons carry focus, keyboard control and screen-reader names. */}
          <ol className="river-years" onKeyDown={onKeyDown}>
            {years.map((y, i) => {
              const n = counts[String(y)] ?? 0;
              return (
                <li key={y} style={{ "--i": i } as React.CSSProperties}>
                  <button
                    ref={(el) => {
                      if (el) numerals.current.set(y, el);
                      else numerals.current.delete(y);
                    }}
                    type="button"
                    className="river-year"
                    data-year={y}
                    tabIndex={y === tabYear ? 0 : -1}
                    aria-label={`${y}, ${n || "no"} event${n === 1 ? "" : "s"}`}
                    onFocus={(e) => {
                      s.current.focus = { year: y, visible: e.currentTarget.matches(":focus-visible") };
                      scheduleDraw();
                    }}
                    onBlur={() => {
                      s.current.focus = null;
                      scheduleDraw();
                    }}
                    onClick={(e) => {
                      // Pointer clicks are handled on the canvas side; this is Enter or Space.
                      if (e.detail === 0) onEnter(y);
                    }}
                  >
                    {y}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div ref={tip} className="mark-tip" role="tooltip" />

      <div className="river-ui">
        <form className="arrival" onSubmit={onJump} role="search">
          <span className="wordmark">Nyakati</span>
          <span>Kenya, {firstYear} to today.</span>
          <span className="arrival-hint">Scroll, drag or type a year</span>
          <label htmlFor="jump-year" className="visually-hidden">
            Go to a year
          </label>
          <input
            ref={jumpInput}
            id="jump-year"
            className="jump-input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="year"
            value={jump}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              setJump(v);
              // Four digits is a year: go there without waiting for Enter.
              if (v.length === 4) goTo(v);
            }}
            aria-describedby={jumpError ? "jump-error" : undefined}
          />
          {jumpError && (
            <span id="jump-error" className="jump-error" role="alert">
              {jumpError}
            </span>
          )}
        </form>
      </div>

      <div className="river-foot">
        <nav aria-label="Pages and threads">
          <a href="/list">List</a>
          <a href="/sources">Sources</a>
          {threads.length > 0 && <span className="foot-label">Threads</span>}
          {threads.map((t) => (
            <a key={t.slug} href={`/thread/${t.slug}`} aria-current={thread?.slug === t.slug ? "page" : undefined}>
              {t.title}
            </a>
          ))}
        </nav>
        <div className="zoom" role="group" aria-label="Zoom">
          {ZOOMS.map((level) => (
            <button key={level} type="button" aria-pressed={zoom === level} onClick={() => void zoomTo(level)}>
              {ZOOM_LABEL[level]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
