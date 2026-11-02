import "server-only";
import { listDrafts, listSamples } from "./store";
import type { SimilarPost, VoiceStats } from "./types";

// Plain text analysis over your past writing: repeat detection and writing stats.

const STOP = new Set(
  "a an the and or but if of to in on at for with from by as is are was were be been being it its this that these those i me my we our you your he she they them their so just very really not no do did does have has had can could would should will about into than then there here what which who when where how all any some more most also out up over too only own same such get got".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
    return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}#+\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

const excerpt = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? t.slice(0, 157) + "..." : t;
};

/** Cosine similarity over term counts. */
function cosine(a: string[], b: string[]) {
  const va = new Map<string, number>();
  const vb = new Map<string, number>();
  for (const w of a) va.set(w, (va.get(w) ?? 0) + 1);
  for (const w of b) vb.set(w, (vb.get(w) ?? 0) + 1);
  let dot = 0;
  for (const [w, c] of va) dot += c * (vb.get(w) ?? 0);
  const n = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, c) => s + c * c, 0));
  return dot / (n(va) * n(vb) || 1);
}

/** The past sample or published post closest to `text`, if it's close enough to count as a repeat. */
export async function findSimilar(text: string, opts: { excludeId?: string; threshold?: number } = {}): Promise<SimilarPost | null> {
  const q = tokenize(text);
  if (q.length < 3) return null;
  const [samples, drafts] = await Promise.all([listSamples(), listDrafts()]);
  const docs = [
    ...samples.map((s) => ({ id: s.id, kind: "sample" as const, text: s.text })),
    ...drafts.filter((d) => d.status === "posted").map((d) => ({ id: d.id, kind: "post" as const, text: d.body })),
  ];
  let best: SimilarPost | null = null;
  for (const doc of docs) {
    if (doc.id === opts.excludeId) continue;
    const score = cosine(q, tokenize(doc.text));
    if (!best || score > best.score) best = { id: doc.id, kind: doc.kind, excerpt: excerpt(doc.text), score: Number(score.toFixed(2)) };
  }
  return best && best.score >= (opts.threshold ?? 0.32) ? best : null;
}

const EMOJI = /\p{Extended_Pictographic}/gu;

export function computeStats(texts: string[]): VoiceStats {
  const n = texts.length || 1;
  const words = texts.map((t) => t.split(/\s+/).filter(Boolean).length);
  const sentences = texts.flatMap((t) => t.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 1));
  const sentenceWords = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const paragraphs = texts.flatMap((t) => t.split(/\n\s*\n/).filter((p) => p.trim()));
  const freq = new Map<string, number>();
  for (const t of texts) for (const w of tokenize(t)) if (!w.startsWith("#")) freq.set(w, (freq.get(w) ?? 0) + 1);
  const openings = new Map<string, number>();
  for (const t of texts) {
    const first = t.trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase();
    if (first) openings.set(first, (openings.get(first) ?? 0) + 1);
  }
  return {
    sampleCount: texts.length,
    avgWords: Math.round(words.reduce((a, b) => a + b, 0) / n),
    avgSentenceWords: Number((sentenceWords.reduce((a, b) => a + b, 0) / Math.max(1, sentenceWords.length)).toFixed(1)),
    avgParagraphLines: Number((paragraphs.reduce((a, p) => a + p.split("\n").length, 0) / Math.max(1, paragraphs.length)).toFixed(1)),
    emojiPerPost: Number((texts.reduce((a, t) => a + (t.match(EMOJI)?.length ?? 0), 0) / n).toFixed(1)),
    emDashPerPost: Number((texts.reduce((a, t) => a + (t.match(/—/g)?.length ?? 0), 0) / n).toFixed(1)),
    questionEndingRate: Number((texts.filter((t) => /\?\s*(#\S+\s*)*$/.test(t.trim())).length / n).toFixed(2)),
    hashtagPerPost: Number((texts.reduce((a, t) => a + (t.match(/#\w+/g)?.length ?? 0), 0) / n).toFixed(1)),
    topWords: [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w),
    openingWords: [...openings.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w),
  };
}
