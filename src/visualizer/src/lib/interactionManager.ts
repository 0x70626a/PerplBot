import type { ViewRange } from './types';

export type InteractionCallbacks = {
  onViewChange: (range: ViewRange) => void;
  onHover: (x: number, y: number) => void;
  onHoverEnd: () => void;
  onClick?: (x: number, y: number) => void;
};

export type InteractionManager = {
  destroy(): void;
};

export function createInteractionManager(
  el: HTMLElement,
  getRange: () => ViewRange,
  callbacks: InteractionCallbacks,
): InteractionManager {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartRange: ViewRange | null = null;
  let didDrag = false;

  function clampRange(r: ViewRange): ViewRange {
    return {
      priceMin: r.priceMin,
      priceMax: Math.max(r.priceMax, r.priceMin + 0.01),
      yMin: r.yMin,
      yMax: Math.max(r.yMax, r.yMin + 0.001),
    };
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const range = getRange();
    const rect = el.getBoundingClientRect();

    const fx = (e.clientX - rect.left) / rect.width;
    const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

    const priceRange = range.priceMax - range.priceMin;
    const priceCursor = range.priceMin + fx * priceRange;
    const newRange = priceRange * zoomFactor;

    callbacks.onViewChange(clampRange({
      priceMin: priceCursor - fx * newRange,
      priceMax: priceCursor + (1 - fx) * newRange,
      yMin: range.yMin,
      yMax: range.yMax,
    }));
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isDragging = true;
    didDrag = false;
    dragStartX = e.clientX;
    dragStartRange = { ...getRange() };
    el.style.cursor = 'grabbing';
  }

  function onMouseMove(e: MouseEvent) {
    if (isDragging && dragStartRange) {
      const dx = e.clientX - dragStartX;
      if (Math.abs(dx) > 3) didDrag = true;

      const rect = el.getBoundingClientRect();
      const dxFrac = dx / rect.width;
      const priceRange = dragStartRange.priceMax - dragStartRange.priceMin;

      callbacks.onViewChange(clampRange({
        priceMin: dragStartRange.priceMin - dxFrac * priceRange,
        priceMax: dragStartRange.priceMax - dxFrac * priceRange,
        yMin: dragStartRange.yMin,
        yMax: dragStartRange.yMax,
      }));
    } else {
      callbacks.onHover(e.clientX, e.clientY);
    }
  }

  function onMouseUp(e: MouseEvent) {
    if (isDragging && !didDrag && callbacks.onClick) {
      callbacks.onClick(e.clientX, e.clientY);
    }
    isDragging = false;
    dragStartRange = null;
    el.style.cursor = 'crosshair';
  }

  function onMouseLeave() {
    isDragging = false;
    dragStartRange = null;
    el.style.cursor = 'crosshair';
    callbacks.onHoverEnd();
  }

  el.style.cursor = 'crosshair';
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  el.addEventListener('mouseleave', onMouseLeave);

  return {
    destroy() {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
    },
  };
}
