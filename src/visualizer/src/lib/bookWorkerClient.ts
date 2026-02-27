import type {
  SnapshotView,
  StreamMetrics,
  ConnectionStatus,
  TradeEntry,
  BookWorkerOutMessage,
} from './types';

export type BookWorkerCallbacks = {
  onStatus: (status: ConnectionStatus, message?: string) => void;
  onSnapshot: (data: SnapshotView, metrics: StreamMetrics) => void;
  onUpdate: (data: SnapshotView, metrics: StreamMetrics) => void;
  onTrade: (trade: TradeEntry) => void;
};

export function createBookWorkerClient(callbacks: BookWorkerCallbacks) {
  const worker = new Worker(
    new URL('../workers/bookWorker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent<BookWorkerOutMessage>) => {
    const msg = e.data;
    switch (msg.type) {
      case 'status':
        callbacks.onStatus(msg.status, msg.message);
        break;
      case 'snapshot':
        callbacks.onSnapshot(msg.data, msg.metrics);
        break;
      case 'update':
        callbacks.onUpdate(msg.data, msg.metrics);
        break;
      case 'trade':
        callbacks.onTrade(msg.trade);
        break;
    }
  };

  worker.onerror = (err) => {
    callbacks.onStatus('error', err.message);
  };

  return {
    connect(wsUrl: string, rpcUrl: string, perpId: number, market: string, exchangeAddress: string, chainId: number) {
      worker.postMessage({ type: 'connect', wsUrl, rpcUrl, perpId, market, exchangeAddress, chainId });
    },

    disconnect() {
      worker.postMessage({ type: 'disconnect' });
    },

    setRebuildInterval(intervalMs: number) {
      worker.postMessage({ type: 'setRebuildInterval', intervalMs });
    },

    setL3(enabled: boolean, intervalMs?: number) {
      worker.postMessage({ type: 'setL3', enabled, intervalMs });
    },

    destroy() {
      worker.terminate();
    },
  };
}
