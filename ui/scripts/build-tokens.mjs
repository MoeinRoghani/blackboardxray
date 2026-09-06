// Builds the CSS custom properties every component reads, from the token graph.
//
// Three tiers, in one direction. Primitives hold values, semantic tokens alias
// primitives, and components read semantic tokens through Tailwind. Nothing in
// src/ names a primitive and nothing names a raw value.
//
// Color primitives are generated from @radix-ui/colors rather than authored, so
// the twelve steps carry Radix's fixed roles and no OKLCH ramp is invented here.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as radix from "@radix-ui/colors";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

// Graphite, on a cool-cast neutral rather than a dead one. At these values the
// cast is invisible as colour and entirely visible as intent: a pure #808080
// ramp reads as an absence of a decision. Chroma still only ever carries state.
const HUES = ["slate", "blue", "grass", "amber", "red"];

// Radix's dark scales begin at the darkest colour a *surface* should be. A
// platform frame needs two values below that: the ground the whole application
// sits on, and the interior of a recessed well. Rather than pick two hex values
// by eye, the ramp is continued downward by its own first step, measured in
// OKLab lightness. The result stays on the scale's hue and stays reproducible,
// so the contrast gate is checking a generated value and not a taste.
const SRGB_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_LAB = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

const toLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toGamma = (c) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
const apply = (m, v) => m.map((row) => row.reduce((s, k, i) => s + k * v[i], 0));

function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    toLinear(c / 255)
  );
  return apply(
    LMS_TO_LAB,
    apply(SRGB_TO_LMS, rgb).map((c) => Math.cbrt(c))
  );
}

function oklabToHex([L, a, b]) {
  const lms = [
    L + 0.3963377774 * a + 0.2158037573 * b,
    L - 0.1055613458 * a - 0.0638541728 * b,
    L - 0.0894841775 * a - 1.291485548 * b,
  ].map((c) => c ** 3);
  const rgb = apply(
    [
      [4.0767416621, -3.3077115913, 0.2309699292],
      [-1.2684380046, 2.6097574011, -0.3413193965],
      [-0.0041960863, -0.7034186147, 1.707614701],
    ],
    lms
  );
  return (
    "#" +
    rgb
      .map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

// The two steps below step 1, as multiples of the scale's own first interval.
// Step 0 is the ground; step 00 is the floor of a well, and is deep enough to
// read as a hole rather than as another panel.
const BELOW = { 0: 1.0, "00": 1.85 };

function extendDownward(scale) {
  const one = hexToOklab(scale["1"].$value);
  const two = hexToOklab(scale["2"].$value);
  const interval = two[0] - one[0];
  for (const [name, multiple] of Object.entries(BELOW)) {
    scale[name] = {
      $value: oklabToHex([
        Math.max(0, one[0] - interval * multiple),
        one[1],
        one[2],
      ]),
    };
  }
}

function generateColorPrimitives() {
  const out = {
    $description:
      "Stage 5. Generated from @radix-ui/colors by scripts/build-tokens.mjs. Do not edit by hand.",
    color: {},
  };
  // Each hue ships four scales: solid and alpha, light and dark. The alpha
  // scales are what an overlay reads, so it tints whatever is behind it.
  for (const hue of HUES) {
    for (const variant of ["", "A", "Dark", "DarkA"]) {
      const scale = radix[hue + variant];
      if (!scale) continue;
      const name = hue + variant;
      out.color[name] = {};
      for (const [step, value] of Object.entries(scale)) {
        out.color[name][step.replace(/^[a-zA-Z]+/, "")] = { $value: value };
      }
      if (variant === "Dark") extendDownward(out.color[name]);
    }
  }
  // White over anything is the only way to draw the highlight that makes an
  // edge read as raised. The black alphas are its opposite, for the light
  // theme, where the same edge is drawn as a shadow rather than as a light.
  for (const name of ["whiteA", "blackA"]) {
    out.color[name] = {};
    for (const [step, value] of Object.entries(radix[name])) {
      out.color[name][step.replace(/^[a-zA-Z]+/, "")] = { $value: value };
    }
  }
  writeFileSync(
    join(root, "tokens/primitive/color.json"),
    JSON.stringify(out, null, 2) + "\n"
  );
  return out.color;
}

const colors = generateColorPrimitives();

// Flatten a DTCG-ish tree into { "a-b-c": value }.
function flatten(node, prefix = [], out = {}) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    if (value && typeof value === "object" && "$value" in value) {
      out[[...prefix, key].join("-")] = String(value.$value);
    } else if (value && typeof value === "object") {
      flatten(value, [...prefix, key], out);
    }
  }
  return out;
}

const primitives = {
  ...flatten(read("tokens/primitive/space.json")),
  ...flatten(read("tokens/primitive/radius.json")),
  ...flatten(read("tokens/primitive/type.json")),
  ...flatten(read("tokens/primitive/motion.json")),
  ...flatten(read("tokens/primitive/elevation.json")),
  ...flatten(read("tokens/primitive/zindex.json")),
  ...flatten(read("tokens/primitive/breakpoint.json")),
  ...flatten(read("tokens/primitive/focus.json")),
  ...flatten(read("tokens/primitive/material.json")),
};

// Colour primitives are addressed as {slate.1} in the semantic files.
const colorLookup = {};
for (const [scale, steps] of Object.entries(colors)) {
  for (const [step, entry] of Object.entries(steps)) {
    colorLookup[`${scale}.${step}`] = entry.$value;
  }
}

function resolve(value, where) {
  return value.replace(/\{([^}]+)\}/g, (whole, reference) => {
    if (colorLookup[reference]) return colorLookup[reference];
    const flat = reference.replace(/\./g, "-");
    if (primitives[flat]) return primitives[flat];
    throw new Error(`unresolved token ${whole} in ${where}`);
  });
}

const semanticLight = flatten(read("tokens/semantic/color.light.json"));
const semanticDark = flatten(read("tokens/semantic/color.dark.json"));
const layout = flatten(read("tokens/semantic/space.json"));
const typeRoles = read("tokens/semantic/type.json").text;

const lines = [];
lines.push("/* Generated by scripts/build-tokens.mjs. Do not edit. */");
lines.push("/* Primitives hold values. Semantic tokens alias them. Components read semantic tokens only. */");
lines.push("");
lines.push(":root {");
lines.push("  /* Primitive: the raw scales. Nothing in src/ reads these directly. */");
for (const [name, value] of Object.entries(primitives)) {
  lines.push(`  --${name}: ${value};`);
}
for (const [reference, value] of Object.entries(colorLookup)) {
  lines.push(`  --${reference.replace(".", "-")}: ${value};`);
}
lines.push("");
lines.push("  /* Semantic: named by job. This tier is theming's only moving part. */");
for (const [name, value] of Object.entries(semanticLight)) {
  lines.push(`  --${name.replace(/^color-/, "")}: ${resolve(value, "color.light.json")};`);
}
for (const [name, value] of Object.entries(layout)) {
  lines.push(`  --${name}: ${resolve(value, "space.json")};`);
}
for (const [role, spec] of Object.entries(typeRoles)) {
  for (const [axis, value] of Object.entries(spec)) {
    lines.push(`  --text-${role}-${axis}: ${resolve(String(value), "type.json")};`);
  }
}
lines.push("}");
lines.push("");
lines.push("/* The dark theme is a second scale, not an inversion. Same keys, same jobs. */");
lines.push('[data-theme="dark"] {');
for (const [name, value] of Object.entries(semanticDark)) {
  lines.push(`  --${name.replace(/^color-/, "")}: ${resolve(value, "color.dark.json")};`);
}
for (const level of ["none", "sm", "md", "lg"]) {
  lines.push(`  --shadow-${level}: var(--shadow-dark-${level});`);
}
lines.push("}");
lines.push("");
lines.push("/* Motion above the static tier collapses under a reduced-motion preference. */");
lines.push("@media (prefers-reduced-motion: reduce) {");
lines.push("  :root {");
for (const step of ["fast", "base", "slow"]) {
  lines.push(`    --duration-${step}: 0ms;`);
}
lines.push("  }");
lines.push("}");
lines.push("");

mkdirSync(join(root, "src/styles"), { recursive: true });
writeFileSync(join(root, "src/styles/tokens.css"), lines.join("\n"));

// The Tailwind theme maps utilities onto the semantic tier alone, so a class
// cannot reach a primitive even by accident.
const theme = [];
theme.push("/* Generated by scripts/build-tokens.mjs. Do not edit. */");
theme.push("@theme inline {");
theme.push("  --color-*: initial;");
for (const name of Object.keys(semanticLight)) {
  const short = name.replace(/^color-/, "");
  theme.push(`  --color-${short}: var(--${short});`);
}
theme.push("  --color-transparent: transparent;");
theme.push("  --color-current: currentColor;");
theme.push("");
// Tailwind derives its whole spacing scale from one base, so setting the base
// to the half-step makes every utility a multiple of it. Enumerating ten steps
// instead would leave a component with no legal way to express 14px and force
// the arbitrary values the raw-value gate exists to forbid.
theme.push("  --spacing: var(--space-1);");
theme.push("");
theme.push("  --radius-*: initial;");
for (const name of Object.keys(primitives).filter((n) => n.startsWith("radius-"))) {
  theme.push(`  --radius-${name.replace("radius-", "")}: var(--${name});`);
}
theme.push("");
theme.push("  --text-*: initial;");
for (const name of Object.keys(primitives).filter((n) => n.startsWith("size-"))) {
  theme.push(`  --text-${name.replace("size-", "")}: var(--${name});`);
}
theme.push("");
theme.push("  --font-*: initial;");
theme.push("  --font-sans: var(--font-sans);");
theme.push("  --font-mono: var(--font-mono);");
theme.push("");
theme.push("  --shadow-*: initial;");
for (const level of ["sm", "md", "lg"]) {
  theme.push(`  --shadow-${level}: var(--shadow-${level});`);
}
theme.push("");
// The two layout widths this product names. Exposing them here is what lets a
// component write `w-rail` instead of reaching for an arbitrary value, which
// the raw-value gate forbids and should.
theme.push("  --container-list: var(--layout-list-width);");
theme.push("  --container-sheet: var(--layout-sheet-width);");
// The distance a layer slides back when another is pushed over it, and the
// height of the chrome, exposed so a component names the role and not a value.
theme.push("  --spacing-sheet-peek: var(--layout-sheet-peek);");
theme.push("  --spacing-chrome: var(--layout-chrome-height);");
theme.push("  --spacing-palette-top: var(--layout-palette-top);");
theme.push("  --spacing-bar-value: var(--layout-bar-value);");
theme.push("  --spacing-target: var(--target-min);");
// The frame's fixed band heights and the inspector's width, so a component
// writes `h-bar` and `w-inspector` and never a measurement.
for (const role of [
  "bar-height",
  "status-height",
  "chart-height",
  "facet-height",
  "row-height",
  "timeline-height",
]) {
  theme.push(`  --spacing-${role.replace("-height", "")}: var(--layout-${role});`);
}
theme.push("  --container-inspector: var(--layout-inspector-width);");
theme.push("  --container-table: var(--layout-table-min);");
theme.push("  --container-table-narrow: var(--layout-table-min-narrow);");
theme.push("  --container-bar-label: var(--layout-bar-label);");
theme.push("");
// A breakpoint is emitted as its literal value, not as a var() reference.
// A media query cannot resolve a custom property, so `@media (width >=
// var(--screen-lg))` is invalid and silently kills every responsive variant
// built on it. Everything else here may reference a token; these may not.
theme.push("  --breakpoint-*: initial;");
for (const name of Object.keys(primitives).filter((n) => n.startsWith("screen-"))) {
  theme.push(`  --breakpoint-${name.replace("screen-", "")}: ${primitives[name]};`);
}
theme.push("}");
theme.push("");
writeFileSync(join(root, "src/styles/theme.css"), theme.join("\n"));

console.log(
  `tokens: ${Object.keys(primitives).length} primitive, ` +
    `${Object.keys(colorLookup).length} color steps, ` +
    `${Object.keys(semanticLight).length} semantic, both themes`
);
