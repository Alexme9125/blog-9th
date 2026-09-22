import { describe, expect, it } from "vitest";
import { anniversaryStyles } from "@/components/anniversary/palette";
import {
  anniversaryFrame,
  ANNIVERSARY_DURATION_MS,
  SCENE_HOLD_MS,
  TRANSITION_MS,
} from "@/components/anniversary/timeline";

const colorProperties = [
  "--hero-background",
  "--nine-main",
  "--nine-light",
  "--nine-shadow",
  "--nine-highlight-opacity",
] as const;

describe("anniversary colours", () => {
  it("keeps every colour continuous at all scene boundaries", () => {
    let cursor = 0;
    for (const hold of SCENE_HOLD_MS) {
      const start = cursor + hold;
      const end = start + TRANSITION_MS;
      for (const boundary of [start, end]) {
        const before = anniversaryStyles(anniversaryFrame(boundary - 0.001));
        const after = anniversaryStyles(anniversaryFrame(boundary));
        for (const property of colorProperties) {
          expect(before[property]).toBe(after[property]);
        }
      }
      cursor = end;
    }
  });

  it("interpolates the SVG gradient stops together with the hero background", () => {
    const midpoint = anniversaryStyles(anniversaryFrame(6900));
    expect(midpoint["--nine-main"]).toBe("rgb(68 84 161.5)");
    expect(midpoint["--nine-light"]).toBe("rgb(129.5 141 185.5)");
    expect(midpoint["--nine-shadow"]).toBe("rgb(52.5 60 115)");
    expect(midpoint["--hero-background"]).toBe("rgb(223.5 232.5 233)");
  });

  it("fades the highlight out during the final transition and holds the final palette", () => {
    expect(
      anniversaryStyles(anniversaryFrame(21700))["--nine-highlight-opacity"],
    ).toBe("0.26000");
    const final = anniversaryStyles(anniversaryFrame(ANNIVERSARY_DURATION_MS));
    expect(final["--nine-highlight-opacity"]).toBe("0.00000");
    expect(
      anniversaryStyles(anniversaryFrame(ANNIVERSARY_DURATION_MS + 60000)),
    ).toEqual(final);
    expect(
      new Set(
        [0, 7800, 14800, 22600].map(
          (time) => anniversaryStyles(anniversaryFrame(time))["--nine-main"],
        ),
      ).size,
    ).toBe(4);
  });
});
