import { normalizeUrl } from "./utils.js";

const input = process.argv[2];

if (!input) {
  console.error("Usage: node scripts/normalize-url.js <url>");
  process.exit(1);
}

console.log(normalizeUrl(input));
