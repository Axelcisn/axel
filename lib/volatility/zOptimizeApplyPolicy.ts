export type ZOptimizeCandidateLike = {
  thresholds?: unknown;
  reason?: string | null;
  selectionTier?: "strict" | "bestEffort" | "fallbackAuto";
  strictPass?: boolean;
  recencyPass?: boolean;
};

export type ZOptimizeApplyDecision = {
  hardPass: boolean;
  applied: boolean;
  reason: string | null;
};

export function isHardFailZOptimizeReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return reason.startsWith("noCandidateRecency") || reason.includes("noCandidateStrict");
}

export function decideZOptimizeApply(candidate: ZOptimizeCandidateLike | null | undefined): ZOptimizeApplyDecision {
  const reason = candidate?.reason ?? null;
  const hasThresholds = candidate?.thresholds != null;
  const selectionTier = candidate?.selectionTier;
  const strictPass = candidate?.strictPass;
  const recencyPass = candidate?.recencyPass;

  let hardPass: boolean;
  if (selectionTier) {
    hardPass = selectionTier === "strict" && hasThresholds && (strictPass ?? recencyPass ?? false);
  } else if (typeof strictPass === "boolean" || typeof recencyPass === "boolean") {
    hardPass = hasThresholds && (strictPass ?? recencyPass ?? false);
  } else {
    hardPass = hasThresholds && !isHardFailZOptimizeReason(reason);
  }

  return {
    hardPass,
    applied: hardPass,
    reason,
  };
}
