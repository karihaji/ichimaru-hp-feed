import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, repoRoot, readJson } from "./utils.js";

const config = await readJson("sources.config.json");
const outputDir = path.join(repoRoot, "assets", "site-icons");

await fs.mkdir(outputDir, { recursive: true });

for (const source of config.officialSources || []) {
  if (!source.officialIconSource || !source.favicon) continue;

  const outputPath = path.join(repoRoot, source.favicon);
  const response = await fetch(source.officialIconSource, {
    headers: {
      "user-agent": "ichimaru-hp-feed/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`${source.siteName}: icon fetch failed ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  console.log(`${source.siteName}: ${path.relative(dataDir, outputPath)}`);
}
