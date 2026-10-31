import { host } from "./urlguard.ts";
import { keyOf } from "./verify.ts";

export type Kind = "uploaded" | "first-party" | "official" | "news" | "directory" | "social" | "jobs" | "web";

const SOCIAL = /(^|\.)(instagram|facebook|twitter|x|tiktok|reddit|youtube|pinterest|quora)\.com$|(^|\.)youtu\.be$/;
const JOBS = /(^|\.)(indeed|glassdoor|iimjobs|naukri|ziprecruiter|monster|wellfound)\./;
const NEWS = /(^|\.)(reuters|bloomberg|techcrunch|forbes|wsj|ft|economictimes|livemint|theverge|wired|cnbc|businesswire|prnewswire|venturebeat)\./;
const DIRECTORY = /(^|\.)(crunchbase|cbinsights|pitchbook|g2|capterra|producthunt|tracxn|owler|zoominfo|f6s|dealroom)\./;

/** Heuristic trust weight of a page as evidence. Low-value kinds are read last and cap a claim's confidence. */
// shortcut: hostname/path rules only; replace with a learned or curated domain-reputation list when precision matters
export function scoreSource(url: string, subjects: string[]): { score: number; kind: Kind } {
  if (url.startsWith("doc:")) return { score: 0.9, kind: "uploaded" }; // user-supplied document
  const h = host(url), path = new URL(url).pathname;
  if (SOCIAL.test(h) || (/linkedin\.com$/.test(h) && /\/(posts|pulse|feed)\//.test(path))) return { score: 0.2, kind: "social" };
  if (JOBS.test(h) || /\/(jobs?|careers?)(\/|$)/.test(path)) return { score: 0.25, kind: "jobs" };
  const hk = keyOf(h);
  if (subjects.some(s => keyOf(s).length >= 3 && hk.includes(keyOf(s)))) return { score: 0.95, kind: "first-party" };
  if (/\.(gov|edu)(\.[a-z]{2})?$/.test(h)) return { score: 0.85, kind: "official" };
  if (NEWS.test(h)) return { score: 0.7, kind: "news" };
  if (DIRECTORY.test(h)) return { score: 0.6, kind: "directory" };
  return { score: 0.5, kind: "web" };
}

/** Strongest source, plus a bonus when at least two independent hosts agree. */
export function confidence(scores: number[], independentHosts: number): { value: number; label: "High" | "Medium" | "Low" } {
  const base = Math.max(0, ...scores);
  const value = Math.min(0.99, base + (independentHosts >= 2 ? 0.15 : 0));
  return { value, label: value >= 0.8 ? "High" : value >= 0.55 ? "Medium" : "Low" };
}
