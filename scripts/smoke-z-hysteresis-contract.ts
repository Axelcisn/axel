import { buildBarsFromZEdges } from "@/lib/volatility/zWfoOptimize";

const thresholds = {
  enterLong: 0.05,
  enterShort: 0.05,
  exitLong: 0.02,
  exitShort: 0.02,
  flipLong: 0.1,
  flipShort: 0.1,
};

const zEdgeSequence = [0.01, 0.06, 0.03, 0.015, -0.06, -0.03, 0.12];
const expectedQ = [0, 1, 1, 0, -1, -1, 1];

function main() {
  const series = zEdgeSequence.map((z, idx) => ({
    date: `t${idx}`,
    price: 100,
    zEdge: z,
  }));

  const { bars } = buildBarsFromZEdges(series, thresholds, 0);
  const qSeq = bars.map((b) => (b.signal === "long" ? 1 : b.signal === "short" ? -1 : 0));

  if (qSeq.length !== expectedQ.length) {
    throw new Error(`Length mismatch. Expected ${expectedQ.length} points, got ${qSeq.length}`);
  }

  qSeq.forEach((q, idx) => {
    if (q !== expectedQ[idx]) {
      throw new Error(`State mismatch at idx ${idx}: expected ${expectedQ[idx]} got ${q}`);
    }
  });

  console.log("zEdge\tq_t");
  qSeq.forEach((q, idx) => {
    console.log(`${zEdgeSequence[idx].toFixed(3)}\t${q}`);
  });
  console.log("Hysteresis state machine contract OK.");
}

main();
