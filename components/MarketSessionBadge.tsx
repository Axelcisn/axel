"use client";

import { useEffect, useState } from "react";

type MarketSession = "PRE_MARKET" | "REGULAR" | "AFTER_HOURS" | "OVERNIGHT";

interface MarketSessionBadgeProps {
  symbol: string;
}

function getUsMarketSession(now: Date = new Date()): MarketSession {
  // Convert "now" to US Eastern time using Intl
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const totalMinutes = hour * 60 + minute;

  const min = (h: number, m: number) => h * 60 + m;

  const preStart = min(4, 0);
  const regularStart = min(9, 30);
  const regularEnd = min(16, 0);
  const afterEnd = min(20, 0);

  if (totalMinutes >= preStart && totalMinutes < regularStart) {
    return "PRE_MARKET";
  }
  if (totalMinutes >= regularStart && totalMinutes < regularEnd) {
    return "REGULAR";
  }
  if (totalMinutes >= regularEnd && totalMinutes < afterEnd) {
    return "AFTER_HOURS";
  }
  return "OVERNIGHT";
}

export function MarketSessionBadge({ symbol }: MarketSessionBadgeProps) {
  const [session, setSession] = useState<MarketSession>(() => getUsMarketSession());

  useEffect(() => {
    // Recompute every minute
    const id = setInterval(() => {
      setSession(getUsMarketSession());
    }, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const label =
    session === "PRE_MARKET"
      ? "Pre-Market"
      : session === "REGULAR"
      ? "Regular Hours"
      : session === "AFTER_HOURS"
      ? "After Hours"
      : "Overnight";

  const colorClass =
    session === "PRE_MARKET"
      ? "border-amber-400 text-amber-200"
      : session === "REGULAR"
      ? "border-emerald-400 text-emerald-200"
      : session === "AFTER_HOURS"
      ? "border-pink-400 text-pink-200"
      : "border-sky-400 text-sky-200";

  return (
    <div className="flex items-center gap-2 text-xs text-slate-300">
      <span className="text-slate-400">Session:</span>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${colorClass}`}
      >
        {label}
      </span>
    </div>
  );
}
