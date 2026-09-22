import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const origin = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const round = process.env.QA_ROUND || "round3";
const dir = `docs/qa/${round}`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const admin = JSON.parse(
  readFileSync(process.env.E2E_ADMIN_FILE || ".data/dev-admin.json", "utf8"),
);
const routes = [
  ["home", "/"],
  ["article", "/posts/why-we-imagine"],
  ["formula", "/posts/geometry-of-motion"],
  ["category", "/category/science"],
  ["search", "/search?q=幻想"],
  ["empty", "/search?q=没有这一条线索"],
  ["members", "/members"],
  ["about", "/pages/about"],
  ["login", "/admin/login"],
  ["404", "/missing-trajectory"],
  ["dashboard", "/admin"],
  ["posts", "/admin/posts"],
  ["editor", "/admin/posts/new"],
  ["pages", "/admin/pages/new"],
  ["media", "/admin/media"],
  ["settings", "/admin/settings"],
];
const report = [];
try {
  for (const width of [1440, 768, 390, 360]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS === "1",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let logged = false;
    for (const [name, path] of routes) {
      errors = [];
      if (path.startsWith("/admin") && path != "/admin/login" && !logged) {
        await page.goto(origin + "/admin/login");
        await page.locator("#email").fill(admin.email);
        await page.locator("#password").fill(admin.password);
        await page.getByRole("button", { name: "进入创作空间" }).click();
        await page.waitForURL("**/admin");
        logged = true;
      }
      const response = await page.goto(origin + path);
      await page.locator("main").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (name === "editor" || name === "pages")
        await page.getByLabel("标题", { exact: true }).waitFor();
      if (name === "editor")
        await page.getByRole("textbox", { name: "正文编辑器" }).waitFor();
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        mainCount: document.querySelectorAll("main").length,
        brokenImages: [...document.images]
          .filter((i) => i.complete && !i.naturalWidth)
          .map((i) => i.src),
      }));
      await page.screenshot({ path: `${dir}/${name}-${width}.png` });
      if (name === "formula") {
        await page.locator(".prose").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${dir}/formula-body-${width}.png` });
      }
      report.push({
        name,
        width,
        status: response?.status(),
        ...state,
        errors: [...errors],
      });
    }
    await context.close();
    console.log(`Captured ${width}px`);
  }
  writeFileSync(`${dir}/results.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        screens: report.length,
        issues: report.filter(
          (r) =>
            r.overflow ||
            r.mainCount !== 1 ||
            r.brokenImages.length ||
            r.errors.length ||
            r.status >= 500,
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
