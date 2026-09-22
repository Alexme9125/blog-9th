import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const credentialsPath = process.env.E2E_ADMIN_FILE || ".data/dev-admin.json";
test.skip(
  !existsSync(credentialsPath),
  "Create a local development admin before running browser acceptance.",
);
const run = randomUUID().slice(0, 8);
const title = `验收记录 ${run}：科学与想象`;
const slug = `acceptance-${run}`;
const name = `验收作者 ${run}`;
const email = `acceptance-${run}@darwin.local`;
const temporary = `Temporary-${randomUUID()}`;
const password = `Changed-${randomUUID()}`;

async function login(page: Page, email: string, password: string) {
  if (process.env.E2E_AUTH_DELAY)
    await page.waitForTimeout(Number(process.env.E2E_AUTH_DELAY));
  await page.goto("/admin/login");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "进入创作空间" }).click();
  await expect(page).not.toHaveURL(/\/admin\/login$/);
}

test("建号、首次改密、写作、审核、发布、修订隔离、重发与撤回", async ({
  browser,
  page: admin,
}) => {
  const credential = JSON.parse(readFileSync(credentialsPath, "utf8"));
  await login(admin, credential.email, credential.password);
  await admin.goto("/admin/users");
  await admin.getByRole("button", { name: "创建账号", exact: true }).click();
  const modal = admin.getByRole("dialog");
  await modal.getByLabel("姓名", { exact: true }).fill(name);
  await modal.getByLabel("邮箱", { exact: true }).fill(email);
  await modal.getByLabel("临时密码（至少 12 位）").fill(temporary);
  await modal.getByRole("button", { name: "保存账号" }).click();
  await expect(modal).not.toBeVisible();

  const authorContext = await browser.newContext();
  const author = await authorContext.newPage();
  const publicContext = await browser.newContext();
  const visitor = await publicContext.newPage();
  try {
    await login(author, email, temporary);
    await expect(author).toHaveURL(/\/admin\/password$/);
    await author.getByLabel("当前密码", { exact: true }).fill(temporary);
    await author
      .getByLabel("新密码（至少 12 位）", { exact: true })
      .fill(password);
    await author.getByLabel("再次输入新密码", { exact: true }).fill(password);
    await author.getByRole("button", { name: "保存新密码" }).click();
    await expect(author).toHaveURL(/\/admin\/login$/);
    await login(author, email, password);
    await author.goto("/admin/posts/new");
    await author.getByLabel("标题", { exact: true }).fill(title);
    await author
      .getByLabel("摘要", { exact: true })
      .fill("这是一篇自动化验收记录，验证内容发布边界。");
    await author.getByLabel("页面地址", { exact: true }).fill(slug);
    await author
      .getByRole("textbox", { name: "正文编辑器" })
      .fill("公开正文第一版：好奇心让科学与人文相遇。");
    await author.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(author).toHaveURL(/\/admin\/posts\/[a-f0-9-]{36}$/);
    await expect(author.getByLabel("标题", { exact: true })).toHaveValue(title);
    const id = author.url().split("/").at(-1)!;
    await visitor.goto(`/posts/${slug}`);
    await expect(
      visitor.getByRole("heading", { name: title, exact: true }),
    ).not.toBeVisible();
    await author.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(author.getByRole("heading", { level: 1 })).toContainText(
      "待审核",
    );

    await admin.goto(`/admin/posts/${id}`);
    await expect(admin.getByLabel("标题", { exact: true })).toHaveValue(title);
    await admin.getByRole("button", { name: "发布", exact: true }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(
      "已发布",
    );
    await visitor.goto(`/posts/${slug}`);
    await expect(
      visitor.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();

    await author.goto(`/admin/posts/${id}`);
    await author.getByLabel("标题", { exact: true }).fill(`${title}（第二版）`);
    await author
      .getByRole("textbox", { name: "正文编辑器" })
      .fill("修订正文第二版：尚未审核时应保持私密。");
    await author.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      author.getByText("草稿已保存", { exact: false }),
    ).toBeVisible();
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByText("修订正文第二版：尚未审核时应保持私密。"),
    ).not.toBeVisible();
    await author.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(author.getByRole("heading", { level: 1 })).toContainText(
      "待审核",
    );
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();

    await admin.reload();
    await admin.getByRole("button", { name: "更新发布", exact: true }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(
      "已发布",
    );
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: `${title}（第二版）`, exact: true }),
    ).toBeVisible();
    await admin
      .getByRole("button", { name: "撤回公开版本", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "确认撤回", exact: true })
      .click();
    await expect(admin.getByRole("heading", { level: 1 })).toContainText(
      "草稿",
    );
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: `${title}（第二版）`, exact: true }),
    ).not.toBeVisible();
    for (const route of ["/rss.xml", "/sitemap.xml", `/search?q=${run}`]) {
      const response = await visitor.request.get(route);
      expect(await response.text()).not.toContain(slug);
    }
    await admin
      .getByRole("button", { name: "移入回收站", exact: true })
      .click();
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "确认移入回收站" })
      .click();
    await expect(admin).toHaveURL(/\/admin\/posts$/);
    await admin.goto("/admin/posts?status=trash");
    await expect(
      admin.getByRole("link", { name: `编辑${title}（第二版）`, exact: true }),
    ).toBeVisible();
    await admin
      .getByRole("link", { name: `编辑${title}（第二版）`, exact: true })
      .click();
    await admin.getByRole("button", { name: "永久删除", exact: true }).click();
    await admin
      .getByRole("dialog")
      .getByRole("button", { name: "确认永久删除" })
      .click();
    await expect(admin).toHaveURL(/\/admin\/posts$/);
  } finally {
    await authorContext.close();
    await publicContext.close();
    // Keep the audit trail while revoking the temporary test account's access.
    await admin.goto("/admin/users");
    const row = admin.getByRole("row").filter({ hasText: email });
    if (await row.count()) {
      await row.getByRole("button", { name: "编辑", exact: true }).click();
      await admin.getByRole("dialog").getByLabel("停用账号并撤销会话").check();
      await admin
        .getByRole("dialog")
        .getByRole("button", { name: "保存账号" })
        .click();
    }
  }
});

// This suite owns only the UUID-scoped data it created. Clean it even after a failed assertion.
test.afterAll(async () => {
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) return;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`delete from documents where draft->>'slug' = ${slug}`;
    await sql`delete from "user" where email = ${email}`;
  } finally {
    await sql.end();
  }
});
