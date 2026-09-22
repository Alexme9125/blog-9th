import type { AnniversaryFrame } from "./timeline";

type Color = readonly [number, number, number];
type Palette = {
  background: Color;
  main: Color;
  light: Color;
  shadow: Color;
  highlight: number;
};

// Cool violet, cobalt, patina, then the site's original blue grey.
const palettes: readonly Palette[] = [
  {
    background: [227, 234, 229],
    main: [100, 84, 134],
    light: [153, 135, 180],
    shadow: [73, 58, 105],
    highlight: 0.52,
  },
  {
    background: [220, 231, 237],
    main: [36, 84, 189],
    light: [106, 147, 191],
    shadow: [32, 62, 125],
    highlight: 0.52,
  },
  {
    background: [232, 233, 226],
    main: [66, 111, 112],
    light: [135, 162, 154],
    shadow: [48, 78, 85],
    highlight: 0.52,
  },
  {
    background: [223, 231, 233],
    main: [52, 79, 99],
    light: [102, 127, 139],
    shadow: [38, 60, 75],
    highlight: 0,
  },
];

function mixColor(from: Color, to: Color, progress: number) {
  const channels = from.map((channel, index) =>
    Number((channel + (to[index] - channel) * progress).toFixed(3)),
  );
  return `rgb(${channels.join(" ")})`;
}

export function anniversaryStyles({ from, to, progress }: AnniversaryFrame) {
  const source = palettes[from];
  const target = palettes[to];
  return {
    "--phase": progress.toFixed(5),
    "--bridge": Math.sin(Math.PI * progress).toFixed(5),
    "--hero-background": mixColor(
      source.background,
      target.background,
      progress,
    ),
    "--nine-main": mixColor(source.main, target.main, progress),
    "--nine-light": mixColor(source.light, target.light, progress),
    "--nine-shadow": mixColor(source.shadow, target.shadow, progress),
    "--nine-highlight-opacity": (
      source.highlight +
      (target.highlight - source.highlight) * progress
    ).toFixed(5),
  };
}
