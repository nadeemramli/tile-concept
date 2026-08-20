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

await p.goto("http://localhost:3000/sources/review");
await p.waitForLoadState("networkidle");
// step to the 4th item (the non-duplicate one)
for (let i = 0; i < 3; i++) { await p.getByRole("button", { name: "Next item" }).click(); await p.waitForTimeout(500); }
console.log("position:", (await p.locator("main").innerText()).match(/(\d+)\s+of\s+(\d+)/)?.[0]);
const code = await p.locator("#f-code").inputValue();
console.log("code on screen:", code);
// correct the name, then approve -> should record as "corrected"
await p.locator("#f-name").fill("Fishscale Mosaic Blue (corrected)");
await p.waitForTimeout(300);
const btn = p.getByRole("button", { name: /Correct & approve/ });
console.log("button label present:", await btn.count());
await btn.click();
await p.waitForTimeout(3500);
const toasts = await p.locator("[data-sonner-toast]").allTextContents().catch(() => []);
console.log("TOAST:", JSON.stringify(toasts));
console.log("banner:", (await p.locator("main").innerText()).slice(0, 300).replace(/\n/g, " | "));
await p.screenshot({ path: `${SC}/src-approved.png` });
console.log("ERRORS:", errs.length ? [...new Set(errs)].join(" || ") : "none");
await b.close();
