"use client";

import { useMemo, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
import { useLiveQuote } from "@/lib/hooks/useLiveQuote";

export default function CapitalChartDemoPage() {
  const [symbol] = useState("CAP:OIL_CRUDE");
  const { quote } = useLiveQuote(symbol, { pollMs: 3000 });

  const simulationMode = useMemo(() => ({ baseMode: "unbiased" as const, withTrend: false }), []);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Capital Chart Demo</h1>
        <p className="text-sm text-slate-500">
          Symbol: {symbol} · Live price: {quote?.price ?? "—"} {quote?.source ? `(${quote.source})` : ""} · As of: {quote?.asOf ?? "—"}
        </p>
      </div>

      <PriceChart
        symbol={symbol}
        className="border border-slate-800 rounded-2xl"
        canonicalRows={null}
        horizon={1}
        livePrice={quote?.price ?? null}
        simulationMode={simulationMode}
        cfdInitialEquity={10000}
        cfdLeverage={5}
        cfdPositionFraction={0.2}
        cfdThresholdFrac={0.001}
        cfdCostBps={10}
        cfdZMode="auto"
        cfdSignalRule="bps"
        tradeOverlays={[]}
        cfdAccountHistory={null}
        activeCfdRunId={null}
        onToggleCfdRun={() => {}}
        simulationRuns={[]}
        selectedSimRunId={null}
        onSelectSimulationRun={() => {}}
        selectedSimByDate={null}
        selectedPnlLabel={null}
        selectedOverviewStats={null}
        selectedAnalytics={null}
        simComparePreset={null}
        visibleWindow={null}
        onChangeSimComparePreset={() => {}}
        onChangeSimCompareCustom={() => {}}
        onVisibleWindowChange={() => {}}
        onOpenSimulationSettings={() => {}}
        selectedInterval={null}
        intervalOptions={null}
        onIntervalChange={() => {}}
        horizonCoverage={null}
        showTrendEwma={false}
      />
    </div>
  );
}
