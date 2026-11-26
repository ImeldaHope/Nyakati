import type { Metadata } from "next";
import { readThreads } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return readThreads().map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const thread = readThreads().find((t) => t.slug === slug);
  return { title: `${thread?.title ?? "Thread"} · Nyakati`, description: thread?.description };
}

// The river with one thread drawn is the shell in ../../layout.tsx, which reads the slug from the path.
export default function ThreadPage() {
  return null;
}
