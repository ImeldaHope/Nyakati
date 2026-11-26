import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { readIndex } from "@/lib/data";
import { FIRST_YEAR, yearsBetween } from "@/lib/timeline";

// The social card for each year: the numeral on the ground, as the river shows it.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A year in Nyakati, a timeline of Kenya";

export function generateStaticParams() {
  return yearsBetween(FIRST_YEAR, new Date().getFullYear()).map((year) => ({ year: String(year) }));
}

const font = (file: string) => readFile(path.join(process.cwd(), "assets", "fonts", file));

export default async function Image({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  const count = readIndex().years[year] ?? 0;
  const isNow = Number(year) === new Date().getFullYear();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 72px",
          background: "#14110F",
          color: "#EFE8DA",
        }}
      >
        <div style={{ display: "flex", fontFamily: "Fraunces Text", fontSize: 34 }}>Nyakati</div>
        <div
          style={{
            display: "flex",
            fontFamily: "Fraunces Numeral",
            fontSize: 300,
            lineHeight: 0.8,
            letterSpacing: "-0.03em",
            color: isNow ? "#A8452F" : "#EFE8DA",
          }}
        >
          {year}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Fraunces Text", fontSize: 30, color: "#A39A88" }}>
          <span>A timeline of Kenya, 1895 to today</span>
          <span>{count === 0 ? "No events yet" : `${count} sourced event${count === 1 ? "" : "s"}`}</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Fraunces Numeral", data: await font("Fraunces-144-800.woff"), weight: 800 },
        { name: "Fraunces Text", data: await font("Fraunces-36-400.woff"), weight: 400 },
      ],
    },
  );
}
