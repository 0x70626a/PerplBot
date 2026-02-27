<script lang="ts">
  import { untrack } from 'svelte';
  import type { HeatmapData, ViewRange } from '../lib/types';
  import { createHeatmapRenderer, type HeatmapGL } from '../lib/heatmapRenderer';
  import { createInteractionManager, type InteractionManager } from '../lib/interactionManager';
  import { findNearestOrder, renderOverlay, type OverlayState } from '../lib/overlayRenderer';
  import { computeVisibleStats, type VisibleStats } from '../lib/visibleStats';

  let { data, range = $bindable(), markPrice = 0, oraclePrice = 0 }: {
    data: HeatmapData;
    range: ViewRange;
    markPrice?: number;
    oraclePrice?: number;
  } = $props();

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let glCanvas: HTMLCanvasElement | undefined = $state(undefined);
  let overlayCanvas: HTMLCanvasElement | undefined = $state(undefined);

  let renderer: HeatmapGL | undefined = $state(undefined);
  let interaction: InteractionManager | undefined = undefined;
  let overlayCtx: CanvasRenderingContext2D | undefined = $state(undefined);

  let overlayState: OverlayState = $state({ mouseX: 0, mouseY: 0, visible: false });
  let width = $state(800);
  let height = $state(600);
  let visibleStats: VisibleStats = $state({ maxCumSize: 0, brightnessMin: 0, brightnessMax: 1 });
  let toastMsg: string = $state('');
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function updateRangeWithAutoY(priceMin: number, priceMax: number) {
    const span = priceMax - priceMin;
    if (priceMin < data.dataPriceMin) {
      priceMin = data.dataPriceMin;
      priceMax = priceMin + span;
    }
    if (priceMax > data.dataPriceMax) {
      priceMax = data.dataPriceMax;
      priceMin = priceMax - span;
    }
    priceMin = Math.max(priceMin, data.dataPriceMin);
    priceMax = Math.min(priceMax, data.dataPriceMax);

    const stats = computeVisibleStats(data, priceMin, priceMax);
    visibleStats = stats;
    range = {
      priceMin,
      priceMax,
      yMin: 0,
      yMax: Math.max(stats.maxCumSize * 1.1, 0.001),
    };
  }

  let rendererCanvas: HTMLCanvasElement | undefined;

  $effect(() => {
    if (!glCanvas || !data) return;
    if (renderer && rendererCanvas === glCanvas) {
      renderer.updateData(data);
    } else {
      renderer?.destroy();
      renderer = createHeatmapRenderer(glCanvas, data);
      rendererCanvas = glCanvas;
    }
  });

  $effect(() => {
    return () => {
      renderer?.destroy();
      renderer = undefined;
      rendererCanvas = undefined;
    };
  });

  $effect(() => {
    if (!overlayCanvas) return;
    overlayCtx = overlayCanvas.getContext('2d')!;
  });

  function showToast(msg: string) {
    toastMsg = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ''; }, 1500);
  }

  $effect(() => {
    if (!overlayCanvas) return;
    interaction?.destroy();
    interaction = createInteractionManager(
      overlayCanvas,
      () => range,
      {
        onViewChange(newRange) {
          updateRangeWithAutoY(newRange.priceMin, newRange.priceMax);
        },
        onHover(clientX, clientY) {
          const rect = overlayCanvas!.getBoundingClientRect();
          overlayState = {
            mouseX: (clientX - rect.left) * (overlayCanvas!.width / rect.width),
            mouseY: (clientY - rect.top) * (overlayCanvas!.height / rect.height),
            visible: true,
          };
        },
        onHoverEnd() {
          overlayState = { ...overlayState, visible: false };
        },
        onClick(clientX, clientY) {
          if (!data) return;
          const rect = overlayCanvas!.getBoundingClientRect();
          const fx = (clientX - rect.left) / rect.width;
          const fy = (clientY - rect.top) / rect.height;
          const nearest = findNearestOrder(data, range, fx, fy);
          if (nearest?.user) {
            navigator.clipboard.writeText(nearest.user).then(() => {
              showToast('Address copied');
            });
          }
        },
      },
    );
    return () => {
      interaction?.destroy();
      interaction = undefined;
    };
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
    if (glCanvas) {
      glCanvas.width = width;
      glCanvas.height = height;
    }
    if (overlayCanvas) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }
    renderer?.resize(width, height);
  });

  $effect(() => {
    const _r = range;
    const _d = untrack(() => data);
    if (!_d) return;
    visibleStats = computeVisibleStats(_d, _r.priceMin, _r.priceMax);
  });

  let rafId: number | undefined;

  $effect(() => {
    if (!renderer) return;
    const _d = data;
    const _r = range;
    const _w = width;
    const _h = height;
    const r = renderer;
    const _vs = untrack(() => visibleStats);
    if (rafId !== undefined) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = undefined;
      r.render(_r, _vs.brightnessMin, _vs.brightnessMax);
    });
  });

  $effect(() => {
    if (!overlayCtx) return;
    const _r = range;
    const _s = overlayState;
    const _w = width;
    const _h = height;
    const _d = untrack(() => data);
    if (!_d) return;
    renderOverlay(overlayCtx, _r, _d, _s, _w, _h, markPrice, oraclePrice);
  });
</script>

<div class="heatmap-container" bind:this={containerEl}>
  <canvas class="gl-canvas" bind:this={glCanvas}></canvas>
  <canvas class="overlay-canvas" bind:this={overlayCanvas}></canvas>
  {#if toastMsg}
    <div class="toast">{toastMsg}</div>
  {/if}
</div>

<style>
  .heatmap-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0b0e14;
  }

  .gl-canvas, .overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  .gl-canvas {
    z-index: 0;
  }

  .overlay-canvas {
    z-index: 1;
  }

  .toast {
    position: absolute;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    background: rgba(17, 22, 33, 0.92);
    border: 1px solid rgba(107, 122, 141, 0.4);
    color: #c5cdd9;
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 6px;
    pointer-events: none;
  }
</style>
