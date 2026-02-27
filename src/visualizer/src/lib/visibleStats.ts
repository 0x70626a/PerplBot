import type { HeatmapData } from './types';

export type VisibleStats = {
  maxCumSize: number;
  brightnessMin: number;
  brightnessMax: number;
};

export function computeVisibleStats(
  data: HeatmapData,
  priceMin: number,
  priceMax: number,
): VisibleStats {
  let maxCumSize = 0;
  let brightnessMin = 1;
  let brightnessMax = 0;
  let found = false;

  for (let i = 0; i < data.count; i++) {
    const p = data.prices[i];
    if (p >= priceMin && p <= priceMax) {
      found = true;
      const cum = data.yOffsets[i] + data.sizes[i];
      if (cum > maxCumSize) maxCumSize = cum;
      const b = data.brightness[i];
      if (b < brightnessMin) brightnessMin = b;
      if (b > brightnessMax) brightnessMax = b;
    }
  }

  if (!found) {
    brightnessMin = 0;
    brightnessMax = 1;
  }

  return { maxCumSize, brightnessMin, brightnessMax };
}
