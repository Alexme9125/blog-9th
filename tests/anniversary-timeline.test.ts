import { describe, expect, it } from "vitest";

import {
  ANNIVERSARY_DURATION_MS,
  ANNIVERSARY_SCENES,
  anniversaryFrame,
  SCENE_HOLD_MS,
  TRANSITION_MS,
} from "@/components/anniversary/timeline";

const initialFrame = { from: 0, to: 0, progress: 0, finished: false };

describe("anniversary timeline", () => {
  it("visits the four scenes in order and derives the expected total duration", () => {
    const [animeHold, scienceHold, humanitiesHold] = SCENE_HOLD_MS;
    const sceneStarts = [
      0,
      animeHold + TRANSITION_MS,
      animeHold + TRANSITION_MS + scienceHold + TRANSITION_MS,
      animeHold +
        TRANSITION_MS +
        scienceHold +
        TRANSITION_MS +
        humanitiesHold +
        TRANSITION_MS,
    ];

    expect(ANNIVERSARY_SCENES).toEqual([
      "anime",
      "science",
      "humanities",
      "modern",
    ]);
    expect(sceneStarts.map((time) => anniversaryFrame(time))).toEqual([
      { from: 0, to: 0, progress: 0, finished: false },
      { from: 1, to: 1, progress: 0, finished: false },
      { from: 2, to: 2, progress: 0, finished: false },
      { from: 3, to: 3, progress: 0, finished: true },
    ]);
    expect(ANNIVERSARY_DURATION_MS).toBe(22_600);
  });

  it("begins and completes each transition without a visual endpoint jump", () => {
    let cursor = 0;

    for (let scene = 0; scene < SCENE_HOLD_MS.length; scene += 1) {
      const transitionStart = cursor + SCENE_HOLD_MS[scene];
      const transitionEnd = transitionStart + TRANSITION_MS;

      expect(anniversaryFrame(transitionStart - 0.001)).toEqual({
        from: scene,
        to: scene,
        progress: 0,
        finished: false,
      });
      expect(anniversaryFrame(transitionStart)).toEqual({
        from: scene,
        to: scene + 1,
        progress: 0,
        finished: false,
      });
      expect(
        anniversaryFrame(transitionStart + TRANSITION_MS / 2).progress,
      ).toBeCloseTo(0.5, 10);
      expect(anniversaryFrame(transitionEnd - 0.001)).toMatchObject({
        from: scene,
        to: scene + 1,
        finished: false,
      });
      expect(anniversaryFrame(transitionEnd - 0.001).progress).toBeCloseTo(
        1,
        10,
      );
      expect(anniversaryFrame(transitionEnd)).toEqual({
        from: scene + 1,
        to: scene + 1,
        progress: 0,
        finished: scene + 1 === ANNIVERSARY_SCENES.length - 1,
      });

      cursor = transitionEnd;
    }
  });

  it("clamps negative and non-finite elapsed values to the initial frame", () => {
    for (const elapsed of [
      -1,
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NaN,
    ]) {
      expect(anniversaryFrame(elapsed)).toEqual(initialFrame);
    }
  });

  it("stays on the final modern scene after completion and never wraps", () => {
    const finalFrame = { from: 3, to: 3, progress: 0, finished: true };

    for (const elapsed of [
      ANNIVERSARY_DURATION_MS,
      ANNIVERSARY_DURATION_MS + 1,
      ANNIVERSARY_DURATION_MS * 3,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(anniversaryFrame(elapsed)).toEqual(finalFrame);
      expect(ANNIVERSARY_SCENES[anniversaryFrame(elapsed).from]).toBe("modern");
    }
  });
});
