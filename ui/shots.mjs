import { chromium } from "playwright";
const BASE = "http://127.0.0.1:8900";
const OUT = "/tmp/xray-shots";
const browser = await chromium.launch();
const problems = [];
for (const theme of ["dark", "light"]) {
  for (const vp of [{n:"desktop",width:1440,height:900},{n:"mobile",width:390,height:844}]) {
    const ctx = await browser.newContext({ viewport:{width:vp.width,height:vp.height}, deviceScaleFactor:2 });
    await ctx.addInitScript((t)=>{try{localStorage.setItem("bxr-theme",t)}catch(e){}}, theme);
    const page = await ctx.newPage();
    page.on("console", m => { if (m.type()==="error") problems.push(`console ${theme}/${vp.n}: ${m.text()}`); });
    page.on("pageerror", e => problems.push(`pageerror ${theme}/${vp.n}: ${e.message}`));
    const shots = [
      ["canvas", "/", "text=Choose a run"],
      ["run", "/r/incident-4473", "text=Everything"],
      ["layer", "/r/incident-4473/e/70", null],
      ["stack", "/r/incident-4473/e/70/a/ocp", null],
    ];
    for (const [name, path, wait] of shots) {
      if (vp.n === "mobile" && name === "canvas") continue;
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      if (wait) { try { await page.waitForSelector(wait, {timeout:5000}); } catch { problems.push(`missing ${wait} on ${path} (${theme}/${vp.n})`); } }
      await page.waitForTimeout(700);
      await page.screenshot({ path:`${OUT}/${name}-${theme}-${vp.n}.png` });
      const over = await page.evaluate(()=>document.documentElement.scrollWidth > document.documentElement.clientWidth+1);
      if (over) problems.push(`horizontal overflow on ${path} (${theme}/${vp.n})`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(problems.length ? "PROBLEMS:\n"+problems.join("\n") : "no console errors, no horizontal overflow");
