import type { SideData } from './types';

export function renderDepthChart(
  ctx: CanvasRenderingContext2D,
  bids: SideData,
  asks: SideData,
  priceMin: number,
  priceMax: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const priceRange = priceMax - priceMin;
  if (priceRange <= 0) return;

  let maxCum = 0;

  function findVisibleMax(side: SideData) {
    for (let i = 0; i < side.prices.length; i++) {
      if (side.prices[i] >= priceMin && side.prices[i] <= priceMax) {
        if (side.cumSizes[i] > maxCum) maxCum = side.cumSizes[i];
      }
    }
  }
  findVisibleMax(bids);
  findVisibleMax(asks);

  if (maxCum <= 0) return;

  const padTop = 8;
  const chartH = canvasHeight - padTop;

  function priceToX(p: number): number {
    return ((p - priceMin) / priceRange) * canvasWidth;
  }

  function cumToY(c: number): number {
    return padTop + chartH - (c / maxCum) * chartH;
  }

  // Draw bids (right to left: best bid first, descending)
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < bids.prices.length; i++) {
    const p = bids.prices[i];
    if (p < priceMin || p > priceMax) continue;
    const x = priceToX(p);
    const y = cumToY(bids.cumSizes[i]);
    if (!started) {
      ctx.moveTo(x, cumToY(0));
      ctx.lineTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) {
    ctx.lineTo(0, cumToY(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 200, 83, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Draw asks (left to right: best ask first, ascending)
  ctx.beginPath();
  started = false;
  for (let i = 0; i < asks.prices.length; i++) {
    const p = asks.prices[i];
    if (p < priceMin || p > priceMax) continue;
    const x = priceToX(p);
    const y = cumToY(asks.cumSizes[i]);
    if (!started) {
      ctx.moveTo(x, cumToY(0));
      ctx.lineTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (started) {
    ctx.lineTo(canvasWidth, cumToY(0));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 23, 68, 0.15)';
    ctx.fill();
    ctx.strokeStyle = '#ff1744';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Y-axis labels
  ctx.font = '15px monospace';
  ctx.fillStyle = '#6b7a8d';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yTicks = 3;
  for (let i = 1; i <= yTicks; i++) {
    const c = (maxCum / yTicks) * i;
    const y = cumToY(c);
    const label = c >= 1000 ? `${(c / 1000).toFixed(1)}k` : c.toFixed(1);
    ctx.fillText(label, canvasWidth - 6, y);
  }
}
