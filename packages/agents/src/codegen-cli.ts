import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAgentDefinitions, renderGeneratedModule } from "./codegen-core";

const pkgRoot = join(fileURLToPath(import.meta.url), "..", "..");
const agents = loadAgentDefinitions(join(pkgRoot, "definitions"));
writeFileSync(
  join(pkgRoot, "src", "generated.ts"),
  renderGeneratedModule(agents),
);
console.log(
  `generated.ts written for agents: ${Object.keys(agents).join(", ")}`,
);
