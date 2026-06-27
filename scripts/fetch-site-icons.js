import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, repoRoot, readJson } from "./utils.js";

const config = await readJson("sources.config.json");
const outputDir = path.join(repoRoot, "assets", "site-icons");

await fs.mkdir(outputDir, { recursive: true });

for (const source of config.officialSources || []) {
  await fetchAsset(source, source.officialIconSource, source.favicon, "icon");
  await fetchAsset(source, source.officialListIconSource, source.listIcon, "list icon");
}

async function fetchAsset(source, url, outputFile, label) {
  if (!url || !outputFile) return;

  const outputPath = path.join(repoRoot, outputFile);
  const response = await fetch(url, {
    headers: {
      "user-agent": "ichimaru-hp-feed/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`${source.siteName}: ${label} fetch failed ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  console.log(`${source.siteName} ${label}: ${path.relative(dataDir, outputPath)}`);
}
