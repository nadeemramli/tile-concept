import { chromium } from "@playwright/test";
const SC = process.argv[2];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 200)));
p.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });

await p.goto("http://localhost:3000/login");
await p.locator("#email").fill("demo.catalog@tileconcept.test");
await p.locator("#password").fill("TileDemo!2026");
await p.getByRole("button", { name: "Sign in" }).click();
await p.waitForURL("**/");

for (const [url, name] of [["/sources/library", "library"], ["/sources/review", "review"]]) {
  await p.goto("http://localhost:3000" + url);
  await p.waitForLoadState("networkidle");
  const h1 = await p.locator("main h1").first().textContent().catch(() => null);
  const rows = await p.locator("table tbody tr").count().catch(() => 0);
  console.log(`${url} -> h1="${h1?.trim()}" tableRows=${rows}`);
  await p.screenshot({ path: `${SC}/src-${name}.png` });
}

// open a source drawer
await p.goto("http://localhost:3000/sources/library");
await p.waitForLoadState("networkidle");
await p.locator("table tbody tr").first().click();
await p.waitForTimeout(1200);
console.log("drawer text:", (await p.locator("[role=dialog]").innerText().catch(() => "(none)")).slice(0, 240).replace(/\n/g, " | "));
await p.screenshot({ path: `${SC}/src-drawer.png` });
console.log("ERRORS:", errs.length ? [...new Set(errs)].slice(0,4).join(" || ") : "none");
await b.close();
