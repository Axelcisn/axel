/**
 * Synthetic smoke to ensure z-WFO reason/selectionTier consistency.
 *
 * Run:
 *   npx tsx scripts/smoke-z-wfo-reason-consistency.ts
 */

type ZWfoBestLike = {
  selectionTier: "strict" | "bestEffort" | "fallbackAuto";
  reason?: string | null;
  recencyPass: boolean;
  strictPass: boolean;
  thresholds: Record<string, number>;
};

function assertConsistency(label: string, best: ZWfoBestLike) {
  const reason = best.reason ?? null;

  if (best.selectionTier === "strict") {
    if (!best.strictPass || !best.recencyPass) {
      throw new Error(`${label}: strict tier must have strictPass/recencyPass true`);
    }
    if (reason && (reason.includes("noCandidateRecency") || reason.includes("noCandidateStrict"))) {
      throw new Error(`${label}: strict tier should not carry noCandidate* reason (${reason})`);
    }
  }

  if (reason?.includes("noCandidateRecency") && best.selectionTier === "strict") {
    throw new Error(`${label}: reason cannot include noCandidateRecency for strict tier`);
  }

  if (best.recencyPass && reason?.includes("noCandidateRecency") && best.selectionTier !== "fallbackAuto") {
    throw new Error(`${label}: recencyPass=true but reason indicates recency failure (${reason})`);
  }

  if (best.selectionTier !== "strict") {
    if (!reason || (!reason.includes("noCandidateRecency") && !reason.includes("noCandidateStrict"))) {
      throw new Error(`${label}: non-strict tier should surface strict/recency failure reason`);
    }
  }

  console.log(`${label}: selectionTier=${best.selectionTier} reason=${reason ?? "none"} recencyPass=${best.recencyPass} strictPass=${best.strictPass}`);
}

function main() {
  const cases: Array<{ label: string; best: ZWfoBestLike }> = [
    {
      label: "strict-pass",
      best: {
        selectionTier: "strict",
        reason: "bestScore<=baselineScore",
        recencyPass: true,
        strictPass: true,
        thresholds: { enterLong: 1, enterShort: 1, exitLong: 0.5, exitShort: 0.5, flipLong: 1.5, flipShort: 1.5 },
      },
    },
    {
      label: "best-effort-recency-fail",
      best: {
        selectionTier: "bestEffort",
        reason: "noCandidateRecency; bestEffortReturned",
        recencyPass: false,
        strictPass: false,
        thresholds: { enterLong: 1.1, enterShort: 1.1, exitLong: 0.6, exitShort: 0.6, flipLong: 1.7, flipShort: 1.7 },
      },
    },
    {
      label: "fallback-auto-recency-pass",
      best: {
        selectionTier: "fallbackAuto",
        reason: "noCandidateStrict; fallbackAuto",
        recencyPass: true,
        strictPass: false,
        thresholds: { enterLong: 1.2, enterShort: 1.2, exitLong: 0.7, exitShort: 0.7, flipLong: 1.9, flipShort: 1.9 },
      },
    },
  ];

  cases.forEach(({ label, best }) => assertConsistency(label, best));
}

main();
