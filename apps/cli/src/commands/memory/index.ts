import type { Command } from "commander";

import { registerMemoryCapture } from "./capture";
import { registerMemoryCaptures } from "./captures";
import { registerMemoryNote } from "./note";
import { registerMemorySearch } from "./search";

export function registerMemory(program: Command): void {
  const memory = program
    .command("memory")
    .description("Capture, search, and read company memory");

  registerMemoryCapture(memory);
  registerMemoryCaptures(memory);
  registerMemoryNote(memory);
  registerMemorySearch(memory);
}
