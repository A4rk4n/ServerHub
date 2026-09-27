import Link from "next/link";
import { Ghost } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-candy-200 bg-candy-50 text-plum-500">
        <Ghost size={24} />
      </span>
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-plum-400">Chunk not found</p>
      <h1 className="font-display text-3xl font-bold tracking-tight text-plum-900">This world doesn&apos;t exist</h1>
      <p className="max-w-sm text-[13.5px] text-plum-500">The server you&apos;re looking for was deleted, never generated, or lives beyond the world border.</p>
      <Link href="/" className="mt-2 rounded-full bg-candy-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgba(244,63,146,0.85)] transition hover:bg-candy-400">
        Back to dashboard
      </Link>
    </div>
  );
}
