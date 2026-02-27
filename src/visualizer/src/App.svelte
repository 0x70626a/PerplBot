<script lang="ts">
  import type { SnapshotView, StreamMetrics, ConnectionStatus, TradeEntry } from './lib/types';
  import { type NetworkConfig, getWsUrl } from './lib/constants';
  import { createBookWorkerClient } from './lib/bookWorkerClient';
  import ConnectionPanel from './components/ConnectionPanel.svelte';
  import OrderBook from './components/OrderBook.svelte';
  import Controls from './components/Controls.svelte';
  import Metrics from './components/Metrics.svelte';
  import TradesFeed from './components/TradesFeed.svelte';
  import { onDestroy } from 'svelte';

  let snapshot: SnapshotView | null = $state(null);
  let streamMetrics: StreamMetrics | null = $state(null);
  let error: string | null = $state(null);
  let loading = $state(false);
  let connectionStatus: ConnectionStatus = $state('idle');
  let paused = $state(false);
  let consecutiveFailures = $state(0);
  let trades: TradeEntry[] = $state([]);
  const MAX_TRADES = 50;

  let tickSize = $state(0.1);
  let baseTickSize = $state(0.1);
  let rebuildIntervalMs = $state(100);
  let l3Enabled = $state(false);
  let l3IntervalMs = $state(3000);

  let activeNetwork: NetworkConfig | null = $state(null);
  let activeMarket = $state('');

  $effect(() => {
    client.setRebuildInterval(rebuildIntervalMs);
  });

  $effect(() => {
    client.setL3(l3Enabled, l3IntervalMs);
  });

  let orderBookRef: OrderBook | undefined = $state(undefined);
  let isFirstSnapshot = true;

  const client = createBookWorkerClient({
    onStatus(status, message) {
      connectionStatus = status;
      if (status === 'error' || status === 'disconnected') {
        consecutiveFailures++;
        if (consecutiveFailures > 2 && message) {
          error = `Connection failed (${consecutiveFailures} attempts): ${message}`;
        }
      } else if (status === 'subscribed' || status === 'rpc-polling') {
        consecutiveFailures = 0;
      }
    },
    onSnapshot(data, metrics) {
      snapshot = data;
      streamMetrics = metrics;
      baseTickSize = data.heatmap.tickSize;
      tickSize = data.heatmap.tickSize;
      loading = false;
      error = null;
      consecutiveFailures = 0;
      if (isFirstSnapshot) {
        isFirstSnapshot = false;
        queueMicrotask(() => orderBookRef?.resetView());
      }
    },
    onUpdate(data, metrics) {
      if (paused) return;
      snapshot = data;
      streamMetrics = metrics;
    },
    onTrade(trade) {
      trades = [trade, ...trades.slice(0, MAX_TRADES - 1)];
    },
  });

  onDestroy(() => client.destroy());

  function handleConnect(network: NetworkConfig, perpId: number) {
    const market = network.markets.find(m => m.perpId === perpId);
    if (!market) return;

    loading = true;
    error = null;
    consecutiveFailures = 0;
    snapshot = null;
    streamMetrics = null;
    trades = [];
    isFirstSnapshot = true;
    paused = false;
    activeNetwork = network;
    activeMarket = market.name;

    client.connect(getWsUrl(network), network.rpcUrl, perpId, market.name, network.exchangeAddress, network.chainId);
  }

  function handleDisconnect() {
    client.disconnect();
    connectionStatus = 'idle';
    snapshot = null;
    streamMetrics = null;
    activeNetwork = null;
    activeMarket = '';
    trades = [];
  }

  function resetView() {
    orderBookRef?.resetView();
  }

  function zoomSpread() {
    orderBookRef?.zoomSpread();
  }
</script>

<div class="app">
  <header class="header">
    <h1>Perpl Book Visualizer</h1>
    {#if snapshot}
      <span class="meta">
        {activeMarket}
        {#if activeNetwork}
          ({activeNetwork.name})
        {/if}
        &middot;
        Block {snapshot.meta.blockHeight.toLocaleString()}
        {#if paused}
          &middot; <span class="paused-badge">PAUSED</span>
        {:else if connectionStatus === 'rpc-polling'}
          &middot; <span class="rpc-badge">RPC</span>
        {:else}
          &middot; <span class="live-badge">LIVE</span>
        {/if}
        <button class="pause-btn" onclick={() => paused = !paused}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </span>
    {/if}
  </header>

  {#if !snapshot && !loading}
    <ConnectionPanel
      status={connectionStatus}
      onConnect={handleConnect}
    />
  {/if}

  {#if loading && !snapshot}
    <div class="loading">
      {#if connectionStatus === 'connecting' || connectionStatus === 'connected' || connectionStatus === 'subscribed' || connectionStatus === 'rpc-polling'}
        Connecting to stream...
      {:else if error}
        <div class="retry-error">
          <div class="error-msg">{error}</div>
          <div class="retry-note">Retrying...</div>
        </div>
      {:else}
        Loading...
      {/if}
    </div>
  {/if}

  {#if error && !snapshot && !loading}
    <div class="error">{error}</div>
  {/if}

  {#if snapshot}
    <div class="main-content">
      <div class="sidebar">
        <Controls
          onResetView={resetView}
          onZoomSpread={zoomSpread}
          bind:tickSize
          {baseTickSize}
          bind:rebuildIntervalMs
          bind:l3Enabled
          bind:l3IntervalMs
          isStreaming={true}
        />
        {#if streamMetrics}
          <Metrics metrics={streamMetrics} />
        {/if}
        <TradesFeed {trades} />
        <button class="reset-btn" onclick={handleDisconnect}>
          Disconnect
        </button>
      </div>
      <div class="book-area">
        <OrderBook bind:this={orderBookRef} {snapshot} {tickSize} />
      </div>
    </div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .header h1 {
    font-size: 15px;
    font-weight: 600;
    color: var(--accent);
  }

  .meta {
    font-size: 12px;
    color: var(--text-dim);
  }

  .live-badge {
    color: #42be65;
    font-weight: 600;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .paused-badge {
    color: var(--accent);
    font-weight: 600;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .rpc-badge {
    color: #f1c21b;
    font-weight: 600;
    font-size: 10px;
    letter-spacing: 0.5px;
  }

  .pause-btn {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: inherit;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    margin-left: 4px;
  }

  .pause-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .reset-btn {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
    padding: 8px 16px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    border-radius: 4px;
    width: 100%;
    margin-top: 12px;
  }

  .reset-btn:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-dim);
    font-size: 14px;
  }

  .error {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--red);
    font-size: 14px;
  }

  .retry-error {
    text-align: center;
  }

  .error-msg {
    color: var(--red);
    font-size: 14px;
  }

  .retry-note {
    color: var(--text-dim);
    font-size: 12px;
    margin-top: 4px;
  }

  .main-content {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .sidebar {
    width: 240px;
    flex-shrink: 0;
    padding: 16px;
    border-right: 1px solid var(--border);
    background: var(--bg-surface);
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }

  .book-area {
    flex: 1;
    min-width: 0;
  }
</style>
