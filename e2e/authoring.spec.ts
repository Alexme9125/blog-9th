import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const credentialFile = process.env.E2E_ADMIN_FILE || ".data/dev-admin.json";
test.skip(
  !existsSync(credentialFile),
  "A local development admin is required.",
);
const run = randomUUID().slice(0, 8),
  postSlug = `formats-${run}`,
  pageSlug = `modules-${run}`;
const imageFixture = {
  name: `acceptance-media-${run}.png`,
  mimeType: "image/png",
  buffer: readFileSync("public/images/imagination.png"),
};
async function adminLogin(page: Page) {
  const credential = JSON.parse(readFileSync(credentialFile, "utf8"));
  if (process.env.E2E_AUTH_DELAY)
    await page.waitForTimeout(Number(process.env.E2E_AUTH_DELAY));
  await page.goto("/admin/login");
  await page.getByLabel("邮箱", { exact: true }).fill(credential.email);
  await page.getByLabel("密码", { exact: true }).fill(credential.password);
  await page.getByRole("button", { name: "进入创作空间" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
async function saveNew(page: Page, kind: "post" | "page") {
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/admin/${kind === "post" ? "posts" : "pages"}/[a-f0-9-]{36}$`),
  );
  await expect(
    page.getByRole("alert").filter({ hasText: /失败|不正确|不支持/ }),
  ).toHaveCount(0);
  return page.url().split("/").at(-1)!;
}

test("可视化编辑器保存表格、两种公式和图片，并控制匿名媒体访问", async ({
  page,
  browser,
}) => {
  await adminLogin(page);
  await page.goto("/admin/posts/new");
  const editor = page.getByRole("textbox", { name: "正文编辑器" });
  await editor.fill("观察不是终点：从科学图版走向叙事与知识之间的长期对话。");
  await editor.press("End");
  await editor.press("Enter");
  await page.getByLabel("段落样式").selectOption("h2");
  await page.keyboard.type("公式与记录");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "插入公式", exact: true }).click();
  await page.getByLabel("LaTeX 公式", { exact: true }).fill("E = mc^2");
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await expect(editor.locator(".katex")).toHaveCount(1);
  await editor.locator("p").last().click();
  await editor.press("End");
  await page.getByRole("button", { name: "插入公式", exact: true }).click();
  await page.getByLabel("公式位置").selectOption("inlineMath");
  await page.getByLabel("LaTeX 公式", { exact: true }).fill("a^2+b^2=c^2");
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await expect(editor.locator(".katex")).toHaveCount(2);
  await editor.locator("p").last().click();
  await editor.press("End");
  await editor.press("Enter");
  await page.getByRole("button", { name: "插入表格" }).click();
  await expect(editor.locator("table")).toHaveCount(1);
  for (const [i, text] of ["观察项目", "记录方法", "样本编号"].entries()) {
    await editor.locator("th").nth(i).click();
    await page.keyboard.insertText(text);
  }
  for (const [i, text] of [
    "光线变化",
    "每十分钟记录一次",
    "SAMPLE-A001",
    "轨道运动",
    "比较两组相位参数",
    "SAMPLE-B002",
  ].entries()) {
    await editor.locator("td").nth(i).click();
    await page.keyboard.insertText(text);
  }
  await page
    .getByRole("button", { name: /上传封面图片/ })
    .click({ noWaitAfter: true });
  await page.locator("input[type=file]").last().setInputFiles(imageFixture);
  await expect(page.getByLabel("图片替代文字")).toBeVisible();
  const cover = page.locator("img").last();
  const coverUrl = (await cover.getAttribute("src"))!;
  await page.getByLabel("图片替代文字").fill("验收示例：远方的观测站");
  await page.getByLabel("页面地址", { exact: true }).fill(postSlug);
  await page
    .getByLabel("摘要", { exact: true })
    .fill("自动化验收示例，包含表格、公式、图片与长标题。");
  await page
    .getByLabel("标题", { exact: true })
    .fill(
      "从一次观察开始：在科学、人文与幻想的交汇处，记录那些值得继续追问的问题",
    );
  await saveNew(page, "post");
  const visitor = await browser.newContext();
  try {
    expect((await visitor.request.get(coverUrl)).status()).toBe(401);
    await page.getByRole("button", { name: "发布", exact: true }).click();
    // A newly created route can remount on refresh; assert the persisted state.
    await expect(
      page.getByRole("button", { name: "更新发布", exact: true }),
    ).toBeVisible();
    const reading = await visitor.newPage();
    await reading.goto(`/posts/${postSlug}`);
    await expect(reading.locator(".katex")).toHaveCount(2);
    await expect(reading.locator("table")).toHaveCount(1);
    expect((await visitor.request.get(coverUrl)).status()).toBe(200);
    mkdirSync("docs/qa/stress", { recursive: true });
    for (const width of [1440, 768, 390, 360]) {
      await reading.setViewportSize({ width, height: 1000 });
      await reading.evaluate(() => document.fonts.ready);
      await reading.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await reading.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await reading.screenshot({
        path: `docs/qa/stress/long-title-${width}.png`,
      });
      await reading.locator("table").scrollIntoViewIfNeeded();
      await expect(reading.locator("th").first()).toHaveText("观察项目");
      await reading.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(
        await reading.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await reading.screenshot({
        path: `docs/qa/stress/table-formulas-${width}.png`,
      });
    }
    await page
      .getByRole("button", { name: "撤回公开版本", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认撤回" })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("草稿");
    expect((await visitor.request.get(coverUrl)).status()).toBe(401);
  } finally {
    await visitor.close();
  }
});

test("五类页面模块可排序、保存、预览并发布", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/pages/new");
  for (const label of [
    "富文本",
    "图文组合",
    "图片画廊",
    "成员集合",
    "链接列表",
  ])
    await page.getByRole("button", { name: label, exact: true }).click();
  const titles = page.getByLabel("模块标题（可选）");
  for (let i = 0; i < 5; i++)
    await titles
      .nth(i)
      .fill(["阅读序言", "观察与图像", "画廊", "共同创作者", "继续阅读"][i]);
  await page
    .getByRole("textbox", { name: "正文编辑器" })
    .nth(0)
    .fill("这是用于模块组合验收的示例页面。");
  await page
    .getByRole("textbox", { name: "正文编辑器" })
    .nth(1)
    .fill("在不同媒介之间，保持同一种好奇心。");
  await page
    .locator("label")
    .filter({ hasText: "上传图片" })
    .nth(0)
    .locator("input")
    .setInputFiles(imageFixture);
  await expect(page.locator("img")).toHaveCount(1);
  await page
    .locator("label")
    .filter({ hasText: "上传图片" })
    .nth(1)
    .locator("input")
    .setInputFiles(imageFixture);
  await expect(page.locator("img")).toHaveCount(2);
  await page.getByRole("button", { name: "＋ 添加链接" }).click();
  await page.getByLabel("链接名称", { exact: true }).fill("主要成员");
  await page.getByLabel("链接地址", { exact: true }).fill("/members");
  await page.getByRole("button", { name: "上移模块5" }).click();
  await expect(titles.nth(3)).toHaveValue("继续阅读");
  await page.getByLabel("页面地址", { exact: true }).fill(pageSlug);
  await page.getByLabel("标题", { exact: true }).fill("模块组合验收示例");
  await saveNew(page, "page");
  await page.reload();
  await expect(page.getByLabel("模块标题（可选）").nth(3)).toHaveValue(
    "继续阅读",
  );
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("已发布");
  await page.goto(`/pages/${pageSlug}`);
  await expect(
    page.getByRole("heading", { name: "模块组合验收示例", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "继续阅读", exact: true }),
  ).toBeVisible();
  expect(
    await page.locator('[class*="pageBlock"] > h2').allTextContents(),
  ).toEqual(["阅读序言", "观察与图像", "画廊", "继续阅读", "共同创作者"]);
});

test.afterAll(async ({ browser }) => {
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) return;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`delete from documents where draft->>'slug' in (${postSlug},${pageSlug})`;
  } finally {
    await sql.end();
  }
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await adminLogin(page);
    await page.goto("/admin/media");
    const ownImages = page
      .locator("article")
      .filter({ hasText: imageFixture.name });
    while (await ownImages.count()) {
      const count = await ownImages.count();
      await ownImages
        .first()
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认删除", exact: true })
        .click();
      await expect(ownImages).toHaveCount(count - 1);
    }
  } finally {
    await context.close();
  }
});
