import { computeSessionVwap, type VwapInputBar } from "@/lib/indicators/vwap";

describe("computeSessionVwap (HLC3, session reset)", () => {
  it("computes VWAP per session and resets on session change", () => {
    const bars: VwapInputBar[] = [
      { time: "2024-01-02T09:30:00Z", high: 10, low: 8, close: 9, volume: 100 },
      { time: "2024-01-02T09:35:00Z", high: 12, low: 9, close: 11, volume: 200 },
      { time: "2024-01-02T09:40:00Z", high: 11, low: 10, close: 10.5, volume: 150 },
      { time: "2024-01-03T09:30:00Z", high: 13, low: 11, close: 12, volume: 100 },
      { time: "2024-01-03T09:35:00Z", high: 14, low: 12, close: 13, volume: 50 },
    ];

    const vwap = computeSessionVwap(bars, (bar) =>
      typeof bar.time === "string" ? bar.time.slice(0, 10) : String(bar.time)
    );

    const formatted = vwap.map((v) => (v != null ? Number(v.toFixed(4)) : null));
    // Small helper output so the smoke test is illustrative when it runs
    // eslint-disable-next-line no-console
    console.log("VWAP HLC3 (session)", formatted);

    expect(vwap).toHaveLength(bars.length);
    expect(formatted).toEqual([9, 10.1111, 10.2407, 12, 12.3333]);
  });
});
