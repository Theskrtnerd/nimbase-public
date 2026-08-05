import type { GardenerOp } from "./vfs";

export class GardenerError extends Error {
  constructor(
    message: string,
    readonly partialReport: string,
  ) {
    super(message);
  }
}

export interface GardenerResult {
  report: string;
  usage: { inputTokens: number; outputTokens: number };
  ops: readonly GardenerOp[];
}
