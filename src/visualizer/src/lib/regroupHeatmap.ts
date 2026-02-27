import type { HeatmapData } from './types';

export function regroupHeatmap(original: HeatmapData, newTickSize: number): HeatmapData {
  if (newTickSize <= original.tickSize) return original;

  const count = original.count;

  const groupedPriceFor = (price: number, side: number) => {
    if (side === 0) {
      return Math.floor(price / newTickSize + 1e-9) * newTickSize;
    } else {
      return Math.ceil(price / newTickSize - 1e-9) * newTickSize;
    }
  };

  const byPriceSide = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const gp = groupedPriceFor(original.prices[i], original.sides[i]);
    const key = `${gp}:${original.sides[i]}`;
    let group = byPriceSide.get(key);
    if (!group) {
      group = [];
      byPriceSide.set(key, group);
    }
    group.push(i);
  }

  const newPrices = new Float32Array(count);
  const newYOffsets = new Float32Array(count);
  const newSizes = new Float32Array(count);
  const newSides = new Float32Array(count);
  const newBrightness = new Float32Array(count);
  const newTimestamps = new Float64Array(count);
  const newUsers: string[] = new Array(count);

  let idx = 0;
  let maxCumSize = 0;

  for (const [key, group] of byPriceSide) {
    const gp = parseFloat(key.split(':')[0]);
    group.sort((a, b) => original.timestamps[a] - original.timestamps[b]);

    let cumOffset = 0;
    for (const oi of group) {
      newPrices[idx] = gp;
      newYOffsets[idx] = cumOffset;
      newSizes[idx] = original.sizes[oi];
      newSides[idx] = original.sides[oi];
      newBrightness[idx] = original.brightness[oi];
      newTimestamps[idx] = original.timestamps[oi];
      newUsers[idx] = original.users[oi];
      cumOffset += original.sizes[oi];
      idx++;
    }
    if (cumOffset > maxCumSize) maxCumSize = cumOffset;
  }

  const priceSet = new Set<number>();
  for (const key of byPriceSide.keys()) priceSet.add(parseFloat(key.split(':')[0]));
  const uniquePrices = Array.from(priceSet).sort((a, b) => a - b);

  return {
    prices: newPrices,
    yOffsets: newYOffsets,
    sizes: newSizes,
    sides: newSides,
    brightness: newBrightness,
    timestamps: newTimestamps,
    users: newUsers,
    maxCumSize,
    count,
    timestampMin: original.timestampMin,
    timestampMax: original.timestampMax,
    tickSize: newTickSize,
    dataPriceMin: uniquePrices[0] ?? original.dataPriceMin,
    dataPriceMax: uniquePrices[uniquePrices.length - 1] ?? original.dataPriceMax,
  };
}
