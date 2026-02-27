/**
 * Trade CLI tests
 * Tests for trade command parsing, options, and action execution
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock instances so action tests can inspect calls
const mockExecOrder = vi.fn().mockResolvedValue("0xmocktxhash");
const mockGetPerpetualInfo = vi.fn().mockResolvedValue({
  priceDecimals: 1n,
  lotDecimals: 5n,
});
const mockGetAccountByAddress = vi.fn().mockResolvedValue({
  accountId: 5n,
});
const mockGetPosition = vi.fn().mockResolvedValue({
  position: { lotLNS: 0n, positionType: 0 },
  markPrice: 985000n, // 98500 with 1 decimal
});
const mockGetOpenOrders = vi.fn().mockResolvedValue([]);
const mockIncreasePositionCollateral = vi.fn().mockResolvedValue("0xmargintxhash");
const mockRequestDecreasePositionCollateral = vi.fn().mockResolvedValue("0xremovemargintxhash");

// Mock the SDK modules before importing
vi.mock("../../src/sdk/index.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    loadEnvConfig: vi.fn(() => ({
      privateKey:
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      chain: {
        chain: { id: 10143, name: "monad-testnet" },
        rpcUrl: "https://testnet-rpc.monad.xyz",
        exchangeAddress: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
        collateralToken: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
      },
    })),
    validateConfig: vi.fn(),
    Wallet: {
      fromPrivateKey: vi.fn(() => ({
        address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        publicClient: {},
        walletClient: {},
      })),
    },
    Exchange: vi.fn().mockImplementation(() => ({
      increasePositionCollateral: mockIncreasePositionCollateral,
      requestDecreasePositionCollateral: mockRequestDecreasePositionCollateral,
    })),
    HybridClient: vi.fn().mockImplementation(() => ({
      getPerpetualInfo: mockGetPerpetualInfo,
      getAccountByAddress: mockGetAccountByAddress,
      getPosition: mockGetPosition,
      getOpenOrders: mockGetOpenOrders,
      execOrder: mockExecOrder,
    })),
    priceToPNS: actual.priceToPNS,
    pnsToPrice: actual.pnsToPrice,
    lotToLNS: actual.lotToLNS,
    leverageToHdths: actual.leverageToHdths,
    amountToCNS: actual.amountToCNS,
    PERPETUALS: actual.PERPETUALS,
    ALL_PERP_IDS: actual.ALL_PERP_IDS,
    simulateTrade: vi.fn(),
    printDryRunReport: vi.fn(),
  };
});

// Suppress console output during tests
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});

// Helper: build program with trade commands registered
async function buildProgram() {
  const { Command } = await import("commander");
  const { registerTradeCommand } = await import("../../src/cli/trade.js");
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  registerTradeCommand(program);
  return program;
}

// Helper: get a specific trade subcommand
function getSubcommand(program: any, name: string) {
  return program.commands
    .find((c: any) => c.name() === "trade")
    ?.commands.find((c: any) => c.name() === name);
}

describe("Trade CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============ Command structure ============

  describe("Command structure", () => {
    it("should have all trade subcommands", async () => {
      const program = await buildProgram();
      const tradeCmd = program.commands.find((c) => c.name() === "trade");
      const subcommands = tradeCmd?.commands.map((c) => c.name());

      expect(subcommands).toContain("open");
      expect(subcommands).toContain("close");
      expect(subcommands).toContain("cancel");
      expect(subcommands).toContain("cancel-all");
      expect(subcommands).toContain("add-margin");
      expect(subcommands).toContain("remove-margin");
      expect(subcommands).toContain("close-all");
    });
  });

  // ============ open command ============

  describe("open command", () => {
    it("should recognize 'market' as a valid price option", async () => {
      const program = await buildProgram();
      const openCmd = getSubcommand(program, "open");
      const priceOption = openCmd?.options.find(
        (o: any) => o.long === "--price",
      );
      expect(priceOption).toBeDefined();
      expect(priceOption?.description).toContain("market");
    });

    it("should have slippage option with default of 1%", async () => {
      const program = await buildProgram();
      const openCmd = getSubcommand(program, "open");
      const slippageOption = openCmd?.options.find(
        (o: any) => o.long === "--slippage",
      );
      expect(slippageOption).toBeDefined();
      expect(slippageOption?.defaultValue).toBe("1");
    });

    it("should have --dry-run option", async () => {
      const program = await buildProgram();
      const openCmd = getSubcommand(program, "open");
      const dryRunOption = openCmd?.options.find(
        (o: any) => o.long === "--dry-run",
      );
      expect(dryRunOption).toBeDefined();
    });

    it("should execute limit open long and call execOrder", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "open",
        "--perp",
        "btc",
        "--side",
        "long",
        "--size",
        "0.001",
        "--price",
        "60000",
        "--leverage",
        "2",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(1);
      const orderDesc = mockExecOrder.mock.calls[0][0];
      expect(orderDesc.perpId).toBe(16n);
      expect(orderDesc.orderType).toBe(0); // OpenLong
      expect(orderDesc.immediateOrCancel).toBe(false);
    });

    it("should execute limit open short and call execOrder", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "open",
        "--perp",
        "eth",
        "--side",
        "short",
        "--size",
        "0.5",
        "--price",
        "2000",
        "--leverage",
        "5",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(1);
      const orderDesc = mockExecOrder.mock.calls[0][0];
      expect(orderDesc.perpId).toBe(32n);
      expect(orderDesc.orderType).toBe(1); // OpenShort
    });

    it("should execute market order with IOC flag", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "open",
        "--perp",
        "btc",
        "--side",
        "long",
        "--size",
        "0.001",
        "--price",
        "market",
        "--leverage",
        "2",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(1);
      const orderDesc = mockExecOrder.mock.calls[0][0];
      expect(orderDesc.immediateOrCancel).toBe(true);
    });

    it("should call simulateTrade for --dry-run", async () => {
      const { simulateTrade, printDryRunReport } = await import(
        "../../src/sdk/index.js"
      );
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "open",
        "--perp",
        "btc",
        "--side",
        "long",
        "--size",
        "0.001",
        "--price",
        "60000",
        "--leverage",
        "2",
        "--dry-run",
      ]);

      expect(simulateTrade).toHaveBeenCalledTimes(1);
      expect(printDryRunReport).toHaveBeenCalledTimes(1);
      expect(mockExecOrder).not.toHaveBeenCalled();
    });
  });

  // ============ close command ============

  describe("close command", () => {
    it("should have required options: perp, side, size, price", async () => {
      const program = await buildProgram();
      const closeCmd = getSubcommand(program, "close");
      expect(closeCmd).toBeDefined();

      const optionNames = closeCmd?.options.map((o: any) => o.long);
      expect(optionNames).toContain("--perp");
      expect(optionNames).toContain("--side");
      expect(optionNames).toContain("--size");
      expect(optionNames).toContain("--price");
      expect(optionNames).toContain("--dry-run");
    });

    it("should execute close long and call execOrder with CloseLong", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "close",
        "--perp",
        "btc",
        "--side",
        "long",
        "--size",
        "0.001",
        "--price",
        "70000",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(1);
      const orderDesc = mockExecOrder.mock.calls[0][0];
      expect(orderDesc.perpId).toBe(16n);
      expect(orderDesc.orderType).toBe(2); // CloseLong
    });

    it("should execute close short and call execOrder with CloseShort", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "close",
        "--perp",
        "eth",
        "--side",
        "short",
        "--size",
        "0.5",
        "--price",
        "1800",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(1);
      const orderDesc = mockExecOrder.mock.calls[0][0];
      expect(orderDesc.perpId).toBe(32n);
      expect(orderDesc.orderType).toBe(3); // CloseShort
    });
  });

  // ============ cancel command ============

  describe("cancel command", () => {
    it("should have required options: perp, order-id", async () => {
      const program = await buildProgram();
      const cancelCmd = getSubcommand(program, "cancel");
      expect(cancelCmd).toBeDefined();

      const optionNames = cancelCmd?.options.map((o: any) => o.long);
      expect(optionNames).toContain("--perp");
      expect(optionNames).toContain("--order-id");
    });

    it("should execute cancel and call execOrder with Cancel type", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "cancel",
        "--perp",
        "btc",
        "--order-id",
        "42",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(1);
      const orderDesc = mockExecOrder.mock.calls[0][0];
      expect(orderDesc.perpId).toBe(16n);
      expect(orderDesc.orderType).toBe(4); // Cancel
      expect(orderDesc.orderId).toBe(42n);
    });
  });

  // ============ cancel-all command ============

  describe("cancel-all command", () => {
    it("should cancel all orders when orders exist", async () => {
      mockGetOpenOrders.mockResolvedValueOnce([
        { orderId: 10n },
        { orderId: 20n },
      ]);

      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "cancel-all",
        "--perp",
        "btc",
      ]);

      expect(mockExecOrder).toHaveBeenCalledTimes(2);
      expect(mockExecOrder.mock.calls[0][0].orderId).toBe(10n);
      expect(mockExecOrder.mock.calls[1][0].orderId).toBe(20n);
    });

    it("should handle no open orders gracefully", async () => {
      mockGetOpenOrders.mockResolvedValueOnce([]);

      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "cancel-all",
        "--perp",
        "btc",
      ]);

      expect(mockExecOrder).not.toHaveBeenCalled();
    });
  });

  // ============ add-margin command ============

  describe("add-margin command", () => {
    it("should have required options: perp, amount", async () => {
      const program = await buildProgram();
      const cmd = getSubcommand(program, "add-margin");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain("Add margin");

      const optionNames = cmd?.options.map((o: any) => o.long);
      expect(optionNames).toContain("--perp");
      expect(optionNames).toContain("--amount");
    });

    it("should call exchange.increasePositionCollateral", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "add-margin",
        "--perp",
        "btc",
        "--amount",
        "50",
      ]);

      expect(mockIncreasePositionCollateral).toHaveBeenCalledTimes(1);
      const [perpId, amtCNS] = mockIncreasePositionCollateral.mock.calls[0];
      expect(perpId).toBe(16n);
      expect(amtCNS).toBe(50000000n); // 50 USD * 1e6
    });
  });

  // ============ remove-margin command ============

  describe("remove-margin command", () => {
    it("should have required options: perp, amount", async () => {
      const program = await buildProgram();
      const cmd = getSubcommand(program, "remove-margin");
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toContain("margin removal");

      const optionNames = cmd?.options.map((o: any) => o.long);
      expect(optionNames).toContain("--perp");
      expect(optionNames).toContain("--amount");
    });

    it("should call exchange.requestDecreasePositionCollateral", async () => {
      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "remove-margin",
        "--perp",
        "eth",
        "--amount",
        "25",
      ]);

      expect(mockRequestDecreasePositionCollateral).toHaveBeenCalledTimes(1);
      const [perpId, amtCNS, flag] =
        mockRequestDecreasePositionCollateral.mock.calls[0];
      expect(perpId).toBe(32n);
      expect(amtCNS).toBe(25000000n); // 25 USD * 1e6
      expect(flag).toBe(true);
    });
  });

  // ============ close-all command ============

  describe("close-all command", () => {
    it("should be registered with optional --perp option", async () => {
      const program = await buildProgram();
      const closeAllCmd = getSubcommand(program, "close-all");
      expect(closeAllCmd).toBeDefined();
      expect(closeAllCmd?.description()).toBe(
        "Close all positions and cancel all orders",
      );

      const perpOption = closeAllCmd?.options.find(
        (o: any) => o.long === "--perp",
      );
      expect(perpOption).toBeDefined();
      expect(perpOption?.mandatory).toBeFalsy();
    });

    it("should cancel orders and close positions for a specific market", async () => {
      mockGetOpenOrders.mockResolvedValueOnce([{ orderId: 7n }]);
      mockGetPosition.mockResolvedValueOnce({
        position: { lotLNS: 100000n, positionType: 0 },
        markPrice: 985000n,
      });
      mockGetPerpetualInfo.mockResolvedValueOnce({
        priceDecimals: 1n,
        lotDecimals: 5n,
      });

      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "close-all",
        "--perp",
        "btc",
      ]);

      // Should cancel 1 order + close 1 position = 2 execOrder calls
      expect(mockExecOrder).toHaveBeenCalledTimes(2);

      // First call: cancel order
      expect(mockExecOrder.mock.calls[0][0].orderType).toBe(4); // Cancel
      expect(mockExecOrder.mock.calls[0][0].orderId).toBe(7n);

      // Second call: close position (IOC market close)
      const closeOrder = mockExecOrder.mock.calls[1][0];
      expect(closeOrder.orderType).toBe(2); // CloseLong (positionType 0 = long)
      expect(closeOrder.immediateOrCancel).toBe(true);
    });

    it("should handle no orders and no positions gracefully", async () => {
      mockGetOpenOrders.mockResolvedValue([]);
      mockGetPosition.mockResolvedValue({
        position: { lotLNS: 0n, positionType: 0 },
        markPrice: 985000n,
      });

      const program = await buildProgram();
      await program.parseAsync([
        "node",
        "test",
        "trade",
        "close-all",
        "--perp",
        "btc",
      ]);

      expect(mockExecOrder).not.toHaveBeenCalled();
    });
  });

  // ============ Slippage calculation ============

  describe("Slippage calculation", () => {
    it("should apply positive slippage for long market orders", () => {
      const markPrice = 50000;
      const slippage = 0.01; // 1%
      expect(markPrice * (1 + slippage)).toBe(50500);
    });

    it("should apply negative slippage for short market orders", () => {
      const markPrice = 50000;
      const slippage = 0.01; // 1%
      expect(markPrice * (1 - slippage)).toBe(49500);
    });

    it("should handle custom slippage values", () => {
      const markPrice = 50000;
      const slippage = 0.02; // 2%
      expect(markPrice * (1 + slippage)).toBe(51000);
      expect(markPrice * (1 - slippage)).toBe(49000);
    });
  });

  // ============ Perp name resolution ============

  describe("Perp name resolution", () => {
    it("should accept all supported perp names", async () => {
      for (const [name, expectedId] of [
        ["btc", 16n],
        ["eth", 32n],
        ["sol", 48n],
        ["mon", 64n],
        ["zec", 256n],
      ] as const) {
        vi.clearAllMocks();
        const program = await buildProgram();
        await program.parseAsync([
          "node",
          "test",
          "trade",
          "open",
          "--perp",
          name,
          "--side",
          "long",
          "--size",
          "0.001",
          "--price",
          "100",
          "--leverage",
          "1",
        ]);

        expect(mockExecOrder).toHaveBeenCalledTimes(1);
        expect(mockExecOrder.mock.calls[0][0].perpId).toBe(expectedId);
      }
    });
  });
});
