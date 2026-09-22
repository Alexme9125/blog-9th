export const ANNIVERSARY_SCENES = [
  "anime",
  "science",
  "humanities",
  "modern",
] as const;
export const SCENE_HOLD_MS = [6000, 5200, 6000] as const;
export const TRANSITION_MS = 1800;
export const ANNIVERSARY_DURATION_MS = SCENE_HOLD_MS.reduce(
  (sum, hold) => sum + hold + TRANSITION_MS,
  0,
);
export type AnniversaryFrame = {
  from: number;
  to: number;
  progress: number;
  finished: boolean;
};
export function anniversaryFrame(elapsed: number): AnniversaryFrame {
  let cursor = 0;
  const time = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0);
  for (let index = 0; index < SCENE_HOLD_MS.length; index++) {
    const endHold = cursor + SCENE_HOLD_MS[index];
    if (time < endHold)
      return { from: index, to: index, progress: 0, finished: false };
    const endTransition = endHold + TRANSITION_MS;
    if (time < endTransition) {
      const t = (time - endHold) / TRANSITION_MS;
      const progress =
        t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      return { from: index, to: index + 1, progress, finished: false };
    }
    cursor = endTransition;
  }
  return { from: 3, to: 3, progress: 0, finished: true };
}
export const NINE_PATH =
  "M397 184A112 112 0 1 1 173 184A112 112 0 1 1 397 184M376.75 248.24L252 426.4";
