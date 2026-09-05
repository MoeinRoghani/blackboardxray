// The Stage 8 gate. Reads the generated tokens and holds every pair a person
// actually reads to its floor, in both themes.
//
// A failure is fixed by re-pointing the semantic alias to a different step,
// never by editing a primitive value. Radix's steps carry fixed roles and
// moving one breaks every other pair that depends on it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../src/styles/tokens.css"), "utf8");

function block(selector) {
  const at = css.indexOf(selector + " {");
  if (at < 0) throw new Error(`no ${selector} block in tokens.css`);
  const body = css.slice(at, css.indexOf("\n}", at));
  const found = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    found[name] = value.trim();
  }
  return found;
}

const light = block(":root");
const dark = { ...light, ...block('[data-theme="dark"]') };

function channels(hex) {
  const raw = hex.replace("#", "");
  const wide = raw.length <= 4 ? raw.split("").map((c) => c + c).join("") : raw;
  return [0, 2, 4, 6].map((i) => parseInt(wide.slice(i, i + 2) || "ff", 16));
}

// An alpha colour is read over whatever is behind it, so it is composited
// before it is measured. Measuring the unblended value would pass pairs a
// reader never sees.
function over(colour, backdrop) {
  const [r, g, b, a] = channels(colour);
  const [br, bg, bb] = channels(backdrop);
  const alpha = a / 255;
  return [
    Math.round(r * alpha + br * (1 - alpha)),
    Math.round(g * alpha + bg * (1 - alpha)),
    Math.round(b * alpha + bb * (1 - alpha)),
  ];
}

function luminance([r, g, b]) {
  const linear = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(fg, bg) {
  const front = luminance(over(fg, bg));
  const back = luminance(over(bg, bg));
  const [hi, lo] = front > back ? [front, back] : [back, front];
  return (hi + 0.05) / (lo + 0.05);
}

// Every pair a person reads, and the floor it is held to. 4.5 is the WCAG AA
// minimum for text under 24px, which is every size in this product.
//
// Two floors that look like they belong here do not.
//
// A structural hairline between rows is held to nothing, because it separates
// content rather than bounding a control, and 1.4.11 governs the second.
//
// A status fill is held to nothing, because state in this product is never
// carried by hue alone: every status colour appears beside its own word, so
// the fill reinforces a label rather than being the only thing that carries
// the meaning. A focus ring has no such companion and is held to 3:1.
const PAIRS = [
  ["text-primary", "surface-page", 4.5],
  ["text-primary", "surface-raised", 4.5],
  ["text-primary", "surface-sunken", 4.5],
  ["text-secondary", "surface-page", 4.5],
  ["text-secondary", "surface-raised", 4.5],
  ["text-secondary", "surface-sunken", 4.5],
  ["brand-text", "surface-page", 4.5],
  ["brand-text", "surface-raised", 4.5],
  ["brand-on-solid", "brand-solid", 4.5],
  ["settled-text", "settled-bg", 4.5],
  ["expired-text", "expired-bg", 4.5],
  ["aborted-text", "aborted-bg", 4.5],
  ["open-text", "open-bg", 4.5],
  ["focus", "surface-page", 3],
  ["focus", "surface-raised", 3],
  ["focus", "surface-sunken", 3],
];

let failed = 0;
for (const [theme, tokens] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, floor] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) {
      console.error(`MISSING ${theme}: ${fg} on ${bg}`);
      failed += 1;
      continue;
    }
    const measured = ratio(tokens[fg], tokens[bg]);
    const ok = measured >= floor;
    if (!ok) failed += 1;
    const mark = ok ? "pass" : "FAIL";
    if (!ok || process.env.VERBOSE) {
      console.log(
        `${mark} ${theme.padEnd(5)} ${fg} on ${bg}: ` +
          `${measured.toFixed(2)}:1 (floor ${floor})`
      );
    }
  }
}

if (failed) {
  console.error(`\n${failed} contrast pairs below their floor.`);
  console.error("Re-point the semantic alias to a different Radix step.");
  process.exit(1);
}
console.log(`contrast: ${PAIRS.length * 2} pairs pass in both themes`);
