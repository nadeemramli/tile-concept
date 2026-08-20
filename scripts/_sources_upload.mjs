import { chromium } from "@playwright/test";
const SC = process.argv[2];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await p.goto("http://localhost:3000/login");
await p.locator("#email").fill("demo.catalog@tileconcept.test");
await p.locator("#password").fill("TileDemo!2026");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/");

async function upload(label) {
  await p.goto("http://localhost:3000/sources/library?new=1");
  await p.waitForLoadState("networkidle");
  await p.locator("#source-file").setInputFiles(`${SC}/demo-pricelist.csv`);
  await p.waitForTimeout(400);
  await p.getByRole("button", { name: /Upload and read/ }).click();
  await p.waitForTimeout(6000);
  const txt = await p.locator("[role=dialog]").innerText();
  console.log(`--- ${label}:`, txt.replace(/\n/g, " | ").slice(0, 420));
  await p.screenshot({ path: `${SC}/src-upload-${label}.png` });
}

await upload("first");
await upload("second");
console.log("ERRORS:", errs.length ? [...new Set(errs)].join(" || ") : "none");
await b.close();
