import type { CfdAccountSnapshot, CfdTrade } from "./cfdSim";

export type Trading212AccountSnapshot = CfdAccountSnapshot;

export type Trading212Trade = CfdTrade & {
  runUp?: number;
  drawdown?: number;
};
