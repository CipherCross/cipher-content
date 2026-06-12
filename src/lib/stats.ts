// Helpers for SDR-reported post performance stats (post_stats table).

import { supabase } from "./supabase";

export interface StatValues {
  views: number;
  likes: number;
  comments: number;
}

// Stats older than this are considered stale and surface as "needs update".
export const STALE_DAYS = 7;

export function isStale(recordedAt: string): boolean {
  return Date.now() - new Date(recordedAt).getTime() > STALE_DAYS * 86_400_000;
}

/** Append a new snapshot row. Always writes a complete set of values. */
export async function reportStats(postId: string, values: StatValues) {
  const { data: auth } = await supabase.auth.getUser();
  return supabase.from("post_stats").insert({
    post_id: postId,
    views: values.views,
    likes: values.likes,
    comments: values.comments,
    recorded_by: auth.user?.id ?? null,
  });
}

/** 1240 → "1.2k", 999 → "999", 2_400_000 → "2.4m". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  const fmt = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ""));
  if (n < 1_000_000) return `${fmt(n / 1000)}k`;
  return `${fmt(n / 1_000_000)}m`;
}

/** "just now", "3h ago", "5d ago" — for the Updated column. */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
