<script lang="ts">
  import type { StreamMetrics } from '../lib/types';

  let { metrics }: {
    metrics: StreamMetrics;
  } = $props();
</script>

<div class="metrics">
  <div class="metric-title">Performance</div>

  <div class="metric-row">
    <span class="metric-label">Levels</span>
    <span class="metric-value">{metrics.orderCount.toLocaleString()}</span>
  </div>
  <div class="metric-row">
    <span class="metric-label">Bid levels</span>
    <span class="metric-value">{metrics.bidLevelCount.toLocaleString()}</span>
  </div>
  <div class="metric-row">
    <span class="metric-label">Ask levels</span>
    <span class="metric-value">{metrics.askLevelCount.toLocaleString()}</span>
  </div>
  <div class="metric-row">
    <span class="metric-label">Rebuild</span>
    <span class="metric-value">{metrics.lastRebuildMs.toFixed(1)} ms</span>
  </div>
  <div class="metric-row">
    <span class="metric-label">WS messages</span>
    <span class="metric-value">{metrics.wsMessages.toLocaleString()}</span>
  </div>
  {#if metrics.l3Enabled}
    <div class="metric-row">
      <span class="metric-label">L3 polls</span>
      <span class="metric-value">{metrics.l3Polls.toLocaleString()}</span>
    </div>
  {/if}
  <div class="metric-row">
    <span class="metric-label">Rebuild rate</span>
    <span class="metric-value">{metrics.rebuildIntervalMs} ms</span>
  </div>
  <div class="metric-row">
    <span class="metric-label">Render</span>
    <span class="metric-value">WebGL2 instanced</span>
  </div>
</div>

<style>
  .metrics {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .metric-title {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .metric-row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }

  .metric-label {
    color: var(--text-dim);
  }

  .metric-value {
    color: var(--text);
  }
</style>
