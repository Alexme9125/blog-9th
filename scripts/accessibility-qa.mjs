import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
const b = await chromium.launch({ channel: "chrome", headless: true });
const context = await b.newContext({
  ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS === "1",
  viewport: { width: 1440, height: 1000 },
});
const p = await context.newPage();
const origin = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const routes = [
  "/",
  "/posts/why-we-imagine",
  "/search",
  "/members",
  "/pages/about",
  "/admin/login",
  "/admin",
  "/admin/posts/new",
  "/admin/pages/new",
  "/admin/settings",
];
let logged = false;
const results = [];
try {
  for (const path of routes) {
    if (path.startsWith("/admin") && path != "/admin/login" && !logged) {
      const c = JSON.parse(
        readFileSync(process.env.E2E_ADMIN_FILE || ".data/dev-admin.json"),
      );
      await p.goto(origin + "/admin/login");
      await p.locator("#email").fill(c.email);
      await p.locator("#password").fill(c.password);
      await p.getByRole("button", { name: "进入创作空间" }).click();
      await p.waitForURL("**/admin");
      logged = true;
    }
    await p.goto(origin + path);
    await p.evaluate(() => document.fonts.ready);
    if (path === "/admin/posts/new")
      await p.getByRole("textbox", { name: "正文编辑器" }).waitFor();
    const r = await new AxeBuilder({ page: p })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    results.push({
      path,
      violations: r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          summary: n.failureSummary,
        })),
      })),
    });
  }
  writeFileSync("docs/qa/accessibility.json", JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      results.filter((r) => r.violations.length),
      null,
      2,
    ),
  );
} finally {
  await b.close();
}
