<script lang="ts">
  import type { TradeEntry } from '../lib/types';

  let { trades }: {
    trades: TradeEntry[];
  } = $props();

  function fmtPrice(p: number): string {
    if (p >= 10000) return p.toFixed(0);
    if (p >= 100) return p.toFixed(1);
    if (p >= 1) return p.toFixed(2);
    return p.toFixed(4);
  }

  function fmtSize(s: number): string {
    if (s >= 100) return s.toFixed(2);
    if (s >= 1) return s.toFixed(4);
    return s.toFixed(5);
  }

  function fmtTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false });
  }
</script>

<div class="trades-feed">
  <div class="trades-title">Recent Trades</div>
  <div class="trades-header">
    <span>Price</span>
    <span>Size</span>
    <span>Time</span>
  </div>
  <div class="trades-list">
    {#each trades as trade}
      <div class="trade-row" class:buy={trade.side === 'buy'} class:sell={trade.side === 'sell'}>
        <span class="trade-price">{fmtPrice(trade.price)}</span>
        <span class="trade-size">{fmtSize(trade.size)}</span>
        <span class="trade-time">{fmtTime(trade.timestamp)}</span>
      </div>
    {/each}
    {#if trades.length === 0}
      <div class="no-trades">Waiting for trades...</div>
    {/if}
  </div>
</div>

<style>
  .trades-feed {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .trades-title {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .trades-header {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    font-size: 10px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }

  .trades-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    max-height: 200px;
    overflow-y: auto;
  }

  .trade-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    font-size: 11px;
    padding: 2px 0;
  }

  .trade-row.buy .trade-price {
    color: var(--green);
  }

  .trade-row.sell .trade-price {
    color: var(--red);
  }

  .trade-size {
    color: var(--text);
  }

  .trade-time {
    color: var(--text-dim);
  }

  .no-trades {
    color: var(--text-dim);
    font-size: 11px;
    padding: 8px 0;
  }
</style>
