import { test, expect } from "@playwright/test";

test("键盘入口、移动菜单、暂停动画与减少动态效果", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toBeFocused();
  const anniversary = page.locator('[data-edition="anniversary-9"]');
  if (await anniversary.count()) {
    await expect(anniversary).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: "暂停周年动画" }).click();
    await expect(anniversary).toHaveAttribute("data-running", "false");
    await page.getByRole("button", { name: "继续周年动画" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(anniversary).toHaveAttribute("data-scene", "modern");
    await expect(anniversary).toHaveAttribute("data-running", "false");
  } else {
    await page.getByRole("button", { name: "暂停首屏动画" }).click();
    await expect(
      page.getByRole("button", { name: "播放首屏动画" }),
    ).toBeVisible();
    expect(
      await page
        .locator("[class*=orbit]")
        .evaluate((el) => getComputedStyle(el).animationPlayState),
    ).toBe("paused");
    await page.getByRole("button", { name: "播放首屏动画" }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator("[class*=orbit]")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "打开菜单", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "主要成员", exact: true })
    .click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(
    page.getByRole("button", { name: "打开菜单", exact: true }),
  ).toBeVisible();
});

test("登录服务失败有明确反馈，保留表单输入", async ({ page }) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Service unavailable" }),
    }),
  );
  await page.goto("/admin/login");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill("unavailable@example.test");
  await page.getByLabel("密码", { exact: true }).fill("a-temporary-test-value");
  await page.getByRole("button", { name: "进入创作空间" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "登录服务暂时不可用" }),
  ).toBeVisible();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(
    "unavailable@example.test",
  );
  await page.screenshot({ path: "docs/qa/login-failure.png" });
});
