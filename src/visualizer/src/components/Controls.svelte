<script lang="ts">
  let { onResetView, onZoomSpread, tickSize = $bindable(), baseTickSize, rebuildIntervalMs = $bindable(), l3Enabled = $bindable(), l3IntervalMs = $bindable(), isStreaming = false }: {
    onResetView: () => void;
    onZoomSpread: () => void;
    tickSize: number;
    baseTickSize: number;
    rebuildIntervalMs: number;
    l3Enabled: boolean;
    l3IntervalMs: number;
    isStreaming?: boolean;
  } = $props();

  let inputValue = $state(String(tickSize));
  let rebuildInput = $state(String(rebuildIntervalMs));
  let l3Input = $state(String(l3IntervalMs));

  let lastTickSize = tickSize;
  $effect(() => {
    if (tickSize !== lastTickSize) {
      inputValue = String(tickSize);
      lastTickSize = tickSize;
    }
  });

  function applyTickSize() {
    const val = parseFloat(inputValue);
    if (isNaN(val) || val < baseTickSize) {
      inputValue = String(tickSize);
      return;
    }
    const snapped = Math.round(val / baseTickSize) * baseTickSize;
    const rounded = Math.round(snapped * 1e8) / 1e8;
    tickSize = Math.max(rounded, baseTickSize);
    inputValue = String(tickSize);
  }

  function applyRebuildInterval() {
    const val = parseInt(rebuildInput);
    if (isNaN(val) || val < 1) {
      rebuildInput = String(rebuildIntervalMs);
      return;
    }
    rebuildIntervalMs = val;
    rebuildInput = String(rebuildIntervalMs);
  }

  function applyL3Interval() {
    const val = parseInt(l3Input);
    if (isNaN(val) || val < 500) {
      l3Input = String(l3IntervalMs);
      return;
    }
    l3IntervalMs = val;
    l3Input = String(l3IntervalMs);
  }

  function handleTickKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') applyTickSize();
  }

  function handleRebuildKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') applyRebuildInterval();
  }

  function handleL3Keydown(e: KeyboardEvent) {
    if (e.key === 'Enter') applyL3Interval();
  }
</script>

<div class="controls">
  <div class="control-group">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label>View</label>
    <div class="btn-row">
      <button class="action-btn" onclick={onResetView}>Reset View</button>
      <button class="action-btn" onclick={onZoomSpread}>Zoom Spread</button>
    </div>
  </div>
  <div class="control-group">
    <label for="tick-size-input">Tick Size (base: {baseTickSize})</label>
    <input
      id="tick-size-input"
      type="text"
      bind:value={inputValue}
      onkeydown={handleTickKeydown}
      onblur={applyTickSize}
      class="tick-input"
    />
  </div>
  {#if isStreaming}
    <div class="control-group">
      <label for="rebuild-input" class="has-tooltip">Rebuild Rate (ms)
        <span class="tooltip">How often the heatmap is rebuilt from accumulated updates (lower = smoother but more CPU)</span>
      </label>
      <input
        id="rebuild-input"
        type="text"
        bind:value={rebuildInput}
        onkeydown={handleRebuildKeydown}
        onblur={applyRebuildInterval}
        class="tick-input"
      />
    </div>
    <div class="control-group">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={l3Enabled} />
        L3 On-Chain Orders
      </label>
      {#if l3Enabled}
        <label for="l3-input">L3 Poll Interval (ms)</label>
        <input
          id="l3-input"
          type="text"
          bind:value={l3Input}
          onkeydown={handleL3Keydown}
          onblur={applyL3Interval}
          class="tick-input"
        />
      {/if}
    </div>
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    text-transform: none;
    color: var(--text);
    font-size: 12px;
  }

  .toggle-label input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .btn-row {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 6px 10px;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.1s;
  }

  .action-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .has-tooltip {
    position: relative;
    cursor: help;
  }

  .tooltip {
    display: none;
    position: absolute;
    left: 0;
    top: 100%;
    margin-top: 4px;
    background: var(--border);
    color: var(--text);
    font-size: 10px;
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    padding: 6px 8px;
    border-radius: 4px;
    width: 200px;
    line-height: 1.4;
    z-index: 10;
    white-space: normal;
  }

  .has-tooltip:hover .tooltip {
    display: block;
  }

  .tick-input {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 4px 8px;
    font-family: inherit;
    font-size: 11px;
    border-radius: 3px;
    width: 100%;
    box-sizing: border-box;
  }
</style>
