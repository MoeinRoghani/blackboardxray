// A screen may not set a value. This is the gate that makes that true past
// week one.
//
// A hex, an rgb(), a px literal or a Tailwind arbitrary value inside src/ is a
// decision made on a screen instead of in the token layer, which is the exact
// failure the three tiers exist to prevent. Where a screen needs a value the
// system lacks, that is a gap: add the token, then use it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src");

// tokens.css and theme.css are generated and are where values are allowed to
// live. Everything else in src/ reads them.
const GENERATED = new Set(["tokens.css", "theme.css"]);

// A value ends at anything that is not part of a number or a unit. `\b` is
// wrong here: Tailwind writes a space as an underscore inside an arbitrary
// value, and an underscore is a word character, so `grid-cols-[4rem_auto]` had
// no word boundary after `4rem` and every measurement written inside a grid
// template was invisible to this gate.
const ENDS = "(?![a-zA-Z0-9.])";

const RULES = [
  { name: "hex colour", pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb/hsl/oklch literal", pattern: /\b(?:rgba?|hsla?|oklch|oklab)\s*\(/g },
  { name: "pixel literal", pattern: new RegExp(`(?<![\\w-])\\d+(?:\\.\\d+)?px${ENDS}`, "g") },
  { name: "rem literal", pattern: new RegExp(`(?<![\\w-])\\d+(?:\\.\\d+)?rem${ENDS}`, "g") },
  { name: "em literal", pattern: new RegExp(`(?<![\\w-])\\d+(?:\\.\\d+)?em${ENDS}`, "g") },
  // A grid template is structure, not a value: `minmax(0, 1fr)` and `auto`
  // carry no magnitude and there is no token that could replace them. They are
  // not listed here, and a measurement written inside one is caught by the
  // rules above now that they see past the underscore.
  { name: "tailwind arbitrary value", pattern: /\b(?:bg|text|border|p|px|py|pt|pb|pl|pr|m|mx|my|w|h|size|min-w|min-h|max-w|max-h|gap|rounded|shadow|z|top|left|right|bottom|inset|translate|scale|leading|tracking)-\[[^\]]+\]/g },
];

function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if ([".ts", ".tsx", ".css"].includes(extname(path))) found.push(path);
  }
  return found;
}

let failures = 0;
for (const path of walk(src)) {
  const name = path.split("/").pop();
  if (GENERATED.has(name)) continue;
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  for (const { name: rule, pattern } of RULES) {
    lines.forEach((line, index) => {
      // A comment explaining why is not a value being set.
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      for (const hit of line.matchAll(pattern)) {
        failures += 1;
        console.error(
          `${relative(src, path)}:${index + 1}  ${rule}: ${hit[0].trim()}`
        );
      }
    });
  }
}

if (failures) {
  console.error(
    `\n${failures} raw values in src/. Each is a token that does not exist yet.`
  );
  console.error("Add it to tokens/ and alias it, then use the token here.");
  process.exit(1);
}
console.log("no raw values in src/");
