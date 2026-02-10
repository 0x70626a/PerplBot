/**
 * Contract ABIs for Perpl protocol
 */

/**
 * DelegatedAccount ABI - Owner/Operator wallet pattern for trading
 */
export const DelegatedAccountAbi = [
  // Initializer
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_operator", type: "address" },
      { name: "_exchange", type: "address" },
      { name: "_collateralToken", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // State getters
  {
    type: "function",
    name: "owner",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "operators",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isOperator",
    inputs: [{ name: "_operator", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "exchange",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "collateralToken",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accountId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "operatorAllowlist",
    inputs: [{ name: "", type: "bytes4" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  // Operator management
  {
    type: "function",
    name: "addOperator",
    inputs: [{ name: "_operator", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "removeOperator",
    inputs: [{ name: "_operator", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setOperatorAllowlist",
    inputs: [
      { name: "selector", type: "bytes4" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Account management
  {
    type: "function",
    name: "createAccount",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawCollateral",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rescueTokens",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setExchangeApproval",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Events
  {
    type: "event",
    name: "OperatorAdded",
    inputs: [{ name: "operator", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "OperatorRemoved",
    inputs: [{ name: "operator", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "AccountCreated",
    inputs: [{ name: "accountId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "OperatorAllowlistUpdated",
    inputs: [
      { name: "selector", type: "bytes4", indexed: true },
      { name: "allowed", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ExchangeApprovalUpdated",
    inputs: [{ name: "amount", type: "uint256", indexed: false }],
  },
  // Errors
  { type: "error", name: "OnlyOwnerOrOperator", inputs: [] },
  {
    type: "error",
    name: "SelectorNotAllowed",
    inputs: [{ name: "selector", type: "bytes4" }],
  },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "InsufficientBalance", inputs: [] },
  { type: "error", name: "InvalidReturnData", inputs: [] },
  { type: "error", name: "AccountAlreadyCreated", inputs: [] },
  { type: "error", name: "AccountNotCreated", inputs: [] },
] as const;

/**
 * ERC1967 Proxy ABI (for deployment)
 */
export const ERC1967ProxyAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "implementation", type: "address" },
      { name: "_data", type: "bytes" },
    ],
    stateMutability: "payable",
  },
] as const;

/**
 * ERC20 ABI (minimal for collateral token)
 */
export const ERC20Abi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const;

/**
 * Exchange ABI - Core trading functions
 * Note: Additional functions are called via DelegatedAccount fallback
 */
export const ExchangeAbi = [
  // Account management
  {
    type: "function",
    name: "createAccount",
    inputs: [{ name: "amountCNS", type: "uint256" }],
    outputs: [{ name: "accountId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "depositCollateral",
    inputs: [{ name: "amountCNS", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawCollateral",
    inputs: [{ name: "amountCNS", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Order execution
  {
    type: "function",
    name: "execOrder",
    inputs: [
      {
        name: "orderDesc",
        type: "tuple",
        components: [
          { name: "orderDescId", type: "uint256" },
          { name: "perpId", type: "uint256" },
          { name: "orderType", type: "uint8" },
          { name: "orderId", type: "uint256" },
          { name: "pricePNS", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "expiryBlock", type: "uint256" },
          { name: "postOnly", type: "bool" },
          { name: "fillOrKill", type: "bool" },
          { name: "immediateOrCancel", type: "bool" },
          { name: "maxMatches", type: "uint256" },
          { name: "leverageHdths", type: "uint256" },
          { name: "lastExecutionBlock", type: "uint256" },
          { name: "amountCNS", type: "uint256" },
        ],
      },
    ],
    outputs: [
      {
        name: "signature",
        type: "tuple",
        components: [
          { name: "perpId", type: "uint256" },
          { name: "orderId", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "execOrders",
    inputs: [
      {
        name: "orderDescs",
        type: "tuple[]",
        components: [
          { name: "orderDescId", type: "uint256" },
          { name: "perpId", type: "uint256" },
          { name: "orderType", type: "uint8" },
          { name: "orderId", type: "uint256" },
          { name: "pricePNS", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "expiryBlock", type: "uint256" },
          { name: "postOnly", type: "bool" },
          { name: "fillOrKill", type: "bool" },
          { name: "immediateOrCancel", type: "bool" },
          { name: "maxMatches", type: "uint256" },
          { name: "leverageHdths", type: "uint256" },
          { name: "lastExecutionBlock", type: "uint256" },
          { name: "amountCNS", type: "uint256" },
        ],
      },
      { name: "revertOnFail", type: "bool" },
    ],
    outputs: [
      {
        name: "signatures",
        type: "tuple[]",
        components: [
          { name: "perpId", type: "uint256" },
          { name: "orderId", type: "uint256" },
        ],
      },
    ],
    stateMutability: "nonpayable",
  },
  // Position management
  {
    type: "function",
    name: "increasePositionCollateral",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "amountCNS", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "requestDecreasePositionCollateral",
    inputs: [{ name: "perpId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "decreasePositionCollateral",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "amountCNS", type: "uint256" },
      { name: "clampToMaximum", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowOrderForwarding",
    inputs: [{ name: "allow", type: "bool" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Liquidations
  {
    type: "function",
    name: "buyLiquidations",
    inputs: [
      {
        name: "liquidationDescs",
        type: "tuple[]",
        components: [
          { name: "perpId", type: "uint256" },
          { name: "posAccountId", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "leverageHdths", type: "uint256" },
          { name: "limitPricePNS", type: "uint256" },
        ],
      },
      { name: "revertOnFail", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // View functions
  {
    type: "function",
    name: "getAccountByAddr",
    inputs: [{ name: "accountAddress", type: "address" }],
    outputs: [
      {
        name: "accountInfo",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "balanceCNS", type: "uint256" },
          { name: "lockedBalanceCNS", type: "uint256" },
          { name: "frozen", type: "uint8" },
          { name: "accountAddr", type: "address" },
          {
            name: "positions",
            type: "tuple",
            components: [
              { name: "bank1", type: "uint256" },
              { name: "bank2", type: "uint256" },
              { name: "bank3", type: "uint256" },
              { name: "bank4", type: "uint256" },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAccountById",
    inputs: [{ name: "accountId", type: "uint256" }],
    outputs: [
      {
        name: "accountInfo",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "balanceCNS", type: "uint256" },
          { name: "lockedBalanceCNS", type: "uint256" },
          { name: "frozen", type: "uint8" },
          { name: "accountAddr", type: "address" },
          {
            name: "positions",
            type: "tuple",
            components: [
              { name: "bank1", type: "uint256" },
              { name: "bank2", type: "uint256" },
              { name: "bank3", type: "uint256" },
              { name: "bank4", type: "uint256" },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPosition",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "accountId", type: "uint256" },
    ],
    outputs: [
      {
        name: "positionInfo",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "nextNodeId", type: "uint256" },
          { name: "prevNodeId", type: "uint256" },
          { name: "positionType", type: "uint8" },
          { name: "depositCNS", type: "uint256" },
          { name: "pricePNS", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "entryBlock", type: "uint256" },
          { name: "pnlCNS", type: "int256" },
          { name: "deltaPnlCNS", type: "int256" },
          { name: "premiumPnlCNS", type: "int256" },
        ],
      },
      { name: "markPricePNS", type: "uint256" },
      { name: "markPriceValid", type: "bool" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getPerpetualInfo",
    inputs: [{ name: "perpId", type: "uint256" }],
    outputs: [
      {
        name: "perpetualInfo",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "priceDecimals", type: "uint256" },
          { name: "lotDecimals", type: "uint256" },
          { name: "linkFeedId", type: "bytes32" },
          { name: "priceTolPer100K", type: "uint256" },
          { name: "refPriceMaxAgeSec", type: "uint256" },
          { name: "positionBalanceCNS", type: "uint256" },
          { name: "insuranceBalanceCNS", type: "uint256" },
          { name: "markPNS", type: "uint256" },
          { name: "markTimestamp", type: "uint256" },
          { name: "lastPNS", type: "uint256" },
          { name: "lastTimestamp", type: "uint256" },
          { name: "oraclePNS", type: "uint256" },
          { name: "oracleTimestampSec", type: "uint256" },
          { name: "longOpenInterestLNS", type: "uint256" },
          { name: "shortOpenInterestLNS", type: "uint256" },
          { name: "fundingStartBlock", type: "uint256" },
          { name: "fundingRatePct100k", type: "int16" },
          { name: "synthPerpPricePNS", type: "uint256" },
          { name: "absFundingClampPctPer100K", type: "uint256" },
          { name: "paused", type: "bool" },
          { name: "basePricePNS", type: "uint256" },
          { name: "maxBidPriceONS", type: "uint256" },
          { name: "minBidPriceONS", type: "uint256" },
          { name: "maxAskPriceONS", type: "uint256" },
          { name: "minAskPriceONS", type: "uint256" },
          { name: "numOrders", type: "uint256" },
          { name: "ignOracle", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getExchangeInfo",
    inputs: [],
    outputs: [
      { name: "balanceCNS", type: "uint256" },
      { name: "protocolBalanceCNS", type: "uint256" },
      { name: "recycleBalanceCNS", type: "uint256" },
      { name: "collateralDecimals", type: "uint256" },
      { name: "collateralToken", type: "address" },
      { name: "verifierProxy", type: "address" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTakerFee",
    inputs: [{ name: "perpId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getMakerFee",
    inputs: [{ name: "perpId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  // Trading events
  {
    type: "event",
    name: "OrderRequest",
    inputs: [
      { name: "perpId", type: "uint256", indexed: false },
      { name: "accountId", type: "uint256", indexed: false },
      { name: "orderDescId", type: "uint256", indexed: false },
      { name: "orderId", type: "uint256", indexed: false },
      { name: "orderType", type: "uint8", indexed: false },
      { name: "pricePNS", type: "uint256", indexed: false },
      { name: "lotLNS", type: "uint256", indexed: false },
      { name: "expiryBlock", type: "uint256", indexed: false },
      { name: "postOnly", type: "bool", indexed: false },
      { name: "fillOrKill", type: "bool", indexed: false },
      { name: "immediateOrCancel", type: "bool", indexed: false },
      { name: "maxMatches", type: "uint256", indexed: false },
      { name: "leverageHdths", type: "uint256", indexed: false },
      { name: "gasLeft", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderPlaced",
    inputs: [
      { name: "orderId", type: "uint256", indexed: false },
      { name: "lotLNS", type: "uint256", indexed: false },
      { name: "lockedBalanceCNS", type: "uint256", indexed: false },
      { name: "amountCNS", type: "int256", indexed: false },
      { name: "balanceCNS", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MakerOrderFilled",
    inputs: [
      { name: "perpId", type: "uint256", indexed: false },
      { name: "accountId", type: "uint256", indexed: false },
      { name: "orderId", type: "uint256", indexed: false },
      { name: "pricePNS", type: "uint256", indexed: false },
      { name: "lotLNS", type: "uint256", indexed: false },
      { name: "feeCNS", type: "uint256", indexed: false },
      { name: "lockedBalanceCNS", type: "uint256", indexed: false },
      { name: "amountCNS", type: "int256", indexed: false },
      { name: "balanceCNS", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { name: "lockedBalanceCNS", type: "uint256", indexed: false },
      { name: "amountCNS", type: "int256", indexed: false },
      { name: "balanceCNS", type: "uint256", indexed: false },
    ],
  },
  // Order query functions
  {
    type: "function",
    name: "getOrderIdIndex",
    inputs: [{ name: "perpId", type: "uint256" }],
    outputs: [
      { name: "root", type: "uint256" },
      { name: "leaves", type: "uint256[]" },
      { name: "numOrders", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getOrder",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "orderId", type: "uint256" },
    ],
    outputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "accountId", type: "uint32" },
          { name: "orderType", type: "uint8" },
          { name: "priceONS", type: "uint24" },
          { name: "lotLNS", type: "uint40" },
          { name: "recycleFeeRaw", type: "uint16" },
          { name: "expiryBlock", type: "uint32" },
          { name: "leverageHdths", type: "uint16" },
          { name: "orderId", type: "uint16" },
          { name: "prevOrderId", type: "uint16" },
          { name: "nextOrderId", type: "uint16" },
        ],
      },
    ],
    stateMutability: "view",
  },
  // Orderbook view functions
  {
    type: "function",
    name: "getVolumeAtBookPrice",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "priceONS", type: "uint256" },
    ],
    outputs: [
      { name: "bids", type: "uint256" },
      { name: "expBids", type: "uint256" },
      { name: "asks", type: "uint256" },
      { name: "expAsks", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getNextPriceBelowWithOrders",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "priceONS", type: "uint256" },
    ],
    outputs: [
      { name: "priceBelowONS", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getOrdersAtPriceLevel",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "priceONS", type: "uint256" },
      { name: "pageStartOrderId", type: "uint256" },
      { name: "ordersPerPage", type: "uint256" },
    ],
    outputs: [
      {
        name: "ordersAtPriceLevel",
        type: "tuple[]",
        components: [
          { name: "accountId", type: "uint32" },
          { name: "orderType", type: "uint8" },
          { name: "priceONS", type: "uint24" },
          { name: "lotLNS", type: "uint40" },
          { name: "recycleFeeRaw", type: "uint16" },
          { name: "expiryBlock", type: "uint32" },
          { name: "leverageHdths", type: "uint16" },
          { name: "orderId", type: "uint16" },
          { name: "prevOrderId", type: "uint16" },
          { name: "nextOrderId", type: "uint16" },
        ],
      },
      { name: "numOrders", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;
