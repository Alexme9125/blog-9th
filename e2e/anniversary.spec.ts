import { chromium, webkit, expect, test } from "@playwright/test";

type TransitionReport = {
  resets: number;
  ghosts: string[];
  maximumColourStep: number;
  samples: number;
};

for (const [name, engine] of [
  ["chromium", chromium],
  ["webkit", webkit],
] as const) {
  test(`${name}: anniversary transitions stay coherent and interpolate colours`, async ({}, testInfo) => {
    const browser = await engine.launch({
      headless: true,
      // Explicit undefined clears the project's default Chrome launch channel.
      channel: name === "chromium" ? "chrome" : undefined,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "no-preference",
        ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS === "1",
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(process.env.E2E_BASE_URL || "http://127.0.0.1:3000");
      const hero = page.locator('[data-edition="anniversary-9"]');
      test.skip(
        (await hero.count()) === 0,
        "The anniversary edition must be enabled.",
      );
      await expect(hero).toHaveAttribute("data-ready", "true");
      await page.getByRole("button", { name: "暂停周年动画" }).click();
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));

      await hero.evaluate((element) => {
        const root = element as HTMLElement;
        const records: TransitionReport = {
          resets: 0,
          ghosts: [],
          maximumColourStep: 0,
          samples: 0,
        };
        let previousPhase = Number(root.style.getPropertyValue("--phase"));
        let previousColour: number[] | undefined;
        const observer = new MutationObserver(() => {
          const phase = Number(root.style.getPropertyValue("--phase"));
          if (previousPhase > 0.99 && phase < 0.01) {
            records.resets++;
            if (root.querySelector('[data-state="leaving"]')) {
              records.ghosts.push(root.dataset.scene || "unknown");
            }
          }
          previousPhase = phase;
          const colour = getComputedStyle(root.querySelector("stop")!)
            .stopColor.match(/[\d.]+/g)!
            .map(Number);
          if (previousColour) {
            records.maximumColourStep = Math.max(
              records.maximumColourStep,
              ...colour.map((value, index) =>
                Math.abs(value - previousColour![index]),
              ),
            );
          }
          previousColour = colour;
          records.samples++;
        });
        observer.observe(root, { attributes: true, subtree: true });
        // Store the observer alongside the element without changing app state.
        Object.assign(root, { transitionProbe: { records, observer } });
      });

      const colour = () =>
        hero
          .locator("stop")
          .first()
          .evaluate((element) => getComputedStyle(element).stopColor);
      const colours = [await colour()];
      await page.screenshot({ path: testInfo.outputPath("anime-1440.png") });
      await page.getByRole("button", { name: "继续周年动画" }).click();
      await page.clock.runFor(6800);
      await expect(hero).toHaveAttribute("data-transitioning", "true");
      expect(await colour()).not.toBe(colours[0]);
      await page.getByRole("button", { name: "暂停周年动画" }).click();
      const pausedStyle = await hero.getAttribute("style");
      await page.clock.runFor(8000);
      expect(await hero.getAttribute("style")).toBe(pausedStyle);
      await page.screenshot({
        path: testInfo.outputPath("transition-1440.png"),
      });
      await page.getByRole("button", { name: "继续周年动画" }).click();
      await page.clock.runFor(1600);
      await expect(hero).toHaveAttribute("data-scene", "science");
      colours.push(await colour());
      await page.screenshot({ path: testInfo.outputPath("science-1440.png") });
      await page.clock.runFor(7600);
      await expect(hero).toHaveAttribute("data-scene", "humanities");
      colours.push(await colour());
      await page.screenshot({
        path: testInfo.outputPath("humanities-1440.png"),
      });
      await page.clock.runFor(8000);
      await expect(hero).toHaveAttribute("data-finished", "true");
      colours.push(await colour());
      expect(new Set(colours).size).toBe(4);
      await page.screenshot({ path: testInfo.outputPath("modern-1440.png") });

      const result = await hero.evaluate((element) => {
        const probe = (
          element as HTMLElement & {
            transitionProbe: {
              records: TransitionReport;
              observer: MutationObserver;
            };
          }
        ).transitionProbe;
        probe.observer.disconnect();
        return probe.records;
      });
      expect(result.resets).toBe(3);
      expect(result.ghosts).toEqual([]);
      expect(result.samples).toBeGreaterThan(100);
      expect(result.maximumColourStep).toBeLessThan(5);
      await testInfo.attach("transition-boundaries", {
        body: JSON.stringify({ ...result, colours }, null, 2),
        contentType: "application/json",
      });

      await page.clock.runFor(60000);
      await expect(hero).toHaveAttribute("data-scene", "modern");
      expect(await colour()).toBe(colours[3]);
      for (const width of [768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
        ).toBe(false);
        await page.screenshot({
          path: testInfo.outputPath(`modern-${width}.png`),
        });
      }

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole("button", { name: "重播四幕周年动画" }).click();
      await expect(hero).toHaveAttribute("data-scene", "anime");
      expect(await colour()).toBe(colours[0]);
      await page.getByRole("button", { name: "暂停周年动画" }).click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(hero).toHaveAttribute("data-scene", "modern");
      await expect(hero.getByRole("button")).toHaveCount(0);
      expect(await colour()).toBe(colours[3]);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(hero).toHaveAttribute("data-scene", "modern");
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
}
