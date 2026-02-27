<script lang="ts">
  import type { ConnectionStatus } from '../lib/types';
  import { NETWORKS, type NetworkConfig } from '../lib/constants';

  let { status, onConnect }: {
    status: ConnectionStatus;
    onConnect: (network: NetworkConfig, perpId: number) => void;
  } = $props();

  let selectedNetworkIdx = $state(0);
  let selectedPerpId = $state(NETWORKS[0].markets[0].perpId);

  let network = $derived(NETWORKS[selectedNetworkIdx]);
  let markets = $derived(network.markets);

  // Reset perpId when network changes
  let prevNetIdx: number | undefined;
  $effect(() => {
    if (prevNetIdx !== undefined && selectedNetworkIdx !== prevNetIdx) {
      selectedPerpId = NETWORKS[selectedNetworkIdx].markets[0].perpId;
    }
    prevNetIdx = selectedNetworkIdx;
  });

  function handleConnect() {
    onConnect(network, selectedPerpId);
  }

  const statusColors: Record<ConnectionStatus, string> = {
    idle: '#525252',
    connecting: '#78a9ff',
    connected: '#78a9ff',
    subscribed: '#42be65',
    disconnected: '#ff1744',
    error: '#ff1744',
  };
</script>

<div class="connection-panel">
  <h2>Perpl Book Visualizer</h2>
  <p class="subtitle">Real-time orderbook depth + heatmap</p>

  <div class="form">
    <div class="field">
      <label for="network-select">Network</label>
      <select id="network-select" bind:value={selectedNetworkIdx}>
        {#each NETWORKS as net, i}
          <option value={i}>{net.name} (Chain {net.chainId})</option>
        {/each}
      </select>
    </div>

    <div class="field">
      <label for="market-select">Market</label>
      <select id="market-select" bind:value={selectedPerpId}>
        {#each markets as m}
          <option value={m.perpId}>{m.name} (ID: {m.perpId})</option>
        {/each}
      </select>
    </div>

    <div class="status-row">
      <span class="status-dot" style="background: {statusColors[status]}"></span>
      <span class="status-text">{status}</span>
    </div>

    <button class="connect-btn" onclick={handleConnect} disabled={status === 'connecting'}>
      {status === 'connecting' ? 'Connecting...' : 'Connect'}
    </button>
  </div>

  <div class="info">
    <p>WS: {network.wsUrl}</p>
    <p>RPC: {network.rpcUrl}</p>
  </div>
</div>

<style>
  .connection-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 24px;
    padding: 40px;
  }

  h2 {
    font-size: 20px;
    font-weight: 600;
    color: var(--accent);
  }

  .subtitle {
    color: var(--text-dim);
    font-size: 13px;
    margin-top: -16px;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 320px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  select {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 8px 10px;
    font-family: inherit;
    font-size: 12px;
    border-radius: 4px;
    cursor: pointer;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-text {
    color: var(--text-dim);
    text-transform: capitalize;
  }

  .connect-btn {
    background: var(--accent);
    border: none;
    color: #161616;
    padding: 10px 20px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .connect-btn:hover {
    opacity: 0.85;
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .info {
    font-size: 10px;
    color: var(--text-dim);
    text-align: center;
    line-height: 1.6;
  }
</style>
