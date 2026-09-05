import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8900", OUT = "/tmp/xray-shots";
const browser = await chromium.launch();
const problems = [];
const routes = [
  ["list", "/"],
  ["overview", "/overview"],
  ["run", "/r/incident-4473"],
  ["layer", "/r/incident-4473/e/70"],
  ["stack", "/r/incident-4473/e/70/a/ocp"],
];
for (const theme of ["dark", "light"]) {
  for (const vp of [{n:"desktop",width:1440,height:900},{n:"mobile",width:390,height:844}]) {
    const ctx = await browser.newContext({ viewport:{width:vp.width,height:vp.height}, deviceScaleFactor:2 });
    await ctx.addInitScript((t)=>{try{localStorage.setItem("bxr-theme",t)}catch(e){}}, theme);
    const page = await ctx.newPage();
    page.on("pageerror", e => problems.push(`pageerror ${theme}/${vp.n}: ${e.message}`));
    page.on("console", m => { if (m.type()==="error") problems.push(`console ${theme}/${vp.n}: ${m.text()}`); });
    for (const [name, path] of routes) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await page.screenshot({ path:`${OUT}/${name}-${theme}-${vp.n}.png` });
      // The real check: is the main pane actually usable, not just non-overflowing.
      const m = await page.evaluate(() => {
        const main = document.querySelector("main");
        const de = document.documentElement;
        return {
          mainW: main ? Math.round(main.clientWidth) : -1,
          mainScrollW: main ? Math.round(main.scrollWidth) : -1,
          docOverflow: de.scrollWidth > de.clientWidth + 1,
          mainVisible: main ? getComputedStyle(main).display !== "none" : false,
        };
      });
      if (m.docOverflow) problems.push(`document overflow ${path} (${theme}/${vp.n})`);
      if (m.mainVisible && m.mainW > 0 && m.mainScrollW > m.mainW + 1)
        problems.push(`main content wider than main ${path} (${theme}/${vp.n}): ${m.mainScrollW} > ${m.mainW}`);
      if (m.mainVisible && m.mainW === 0)
        problems.push(`main visible but zero width ${path} (${theme}/${vp.n})`);
    }
    await ctx.close();
  }
}
// Focus trap
const p2 = await browser.newPage({ viewport:{width:1440,height:900} });
await p2.goto(BASE + "/r/incident-4473/e/70", { waitUntil:"networkidle" });
await p2.waitForTimeout(800);
let outside = 0;
for (let i=0;i<14;i++) {
  await p2.keyboard.press("Tab");
  const inSheet = await p2.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]'));
  if (!inSheet) outside++;
}
if (outside > 0) problems.push(`focus escapes the sheet on ${outside} of 14 tab steps`);
// The invisible full stop
const dots = await p2.evaluate(()=>[...document.querySelectorAll("span")].filter(s=>s.textContent==="." && getComputedStyle(s).color.includes("0)")).length);
if (dots) problems.push(`${dots} transparent full stops still rendered`);
await browser.close();
console.log(problems.length ? "PROBLEMS:\n"+problems.join("\n") : "clean: no overflow, no zero-width pane, focus stays in the sheet");
