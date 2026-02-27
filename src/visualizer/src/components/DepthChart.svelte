<script lang="ts">
  import type { SideData } from '../lib/types';
  import { renderDepthChart } from '../lib/depthChartRenderer';

  let { bids, asks, priceMin, priceMax }: {
    bids: SideData;
    asks: SideData;
    priceMin: number;
    priceMax: number;
  } = $props();

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let canvas: HTMLCanvasElement | undefined = $state(undefined);
  let ctx: CanvasRenderingContext2D | undefined = undefined;
  let width = $state(800);
  let height = $state(120);

  $effect(() => {
    if (!canvas) return;
    ctx = canvas.getContext('2d')!;
  });

  $effect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      width = Math.round(rect.width * dpr);
      height = Math.round(rect.height * dpr);
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  $effect(() => {
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  });

  $effect(() => {
    if (!ctx) return;
    const _w = width;
    const _h = height;
    renderDepthChart(ctx, bids, asks, priceMin, priceMax, _w, _h);
  });
</script>

<div class="depth-container" bind:this={containerEl}>
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .depth-container {
    position: relative;
    width: 100%;
    height: 120px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }

  canvas {
    width: 100%;
    height: 100%;
  }
</style>
