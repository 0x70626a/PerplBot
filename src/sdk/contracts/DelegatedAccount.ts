/**
 * DelegatedAccount contract wrapper
 * Handles deployment and management of owner/operator delegated accounts
 */

import {
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  parseEventLogs,
} from "viem";
import { DelegatedAccountAbi, ERC20Abi } from "./abi.js";

/**
 * DelegatedAccount implementation bytecode
 * This is the compiled bytecode of the DelegatedAccount.sol contract
 * In production, you would deploy this once and reuse the implementation address
 */
export const DELEGATED_ACCOUNT_IMPLEMENTATION_BYTECODE =
  "0x" as `0x${string}`; // Placeholder - use deployed implementation

/**
 * ERC1967 Proxy bytecode (OpenZeppelin v5.x)
 * Standard proxy that delegates all calls to implementation
 */
export const ERC1967_PROXY_BYTECODE =
  "0x608060405260405161062f38038061062f833981810160405281019061002591906104cd565b610035828261003c60201b60201c565b505061054f565b61004b826100c060201b60201c565b8173ffffffffffffffffffffffffffffffffffffffff167fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b60405160405180910390a25f815111156100ad576100a7828261018f60201b60201c565b506100bc565b6100bb61029e60201b60201c565b5b5050565b5f8173ffffffffffffffffffffffffffffffffffffffff163b0361011b57806040517f4c9c8ce30000000000000000000000000000000000000000000000000000000081526004016101129190610536565b60405180910390fd5b8061014d7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5f1b6102da60201b60201c565b5f015f6101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff16021790555050565b60605f6101a284846102e360201b60201c565b90508080156101de57505f6101bb6102f760201b60201c565b11806101dd57505f8473ffffffffffffffffffffffffffffffffffffffff163b115b5b156101f9576101f16102fe60201b60201c565b915050610298565b801561023c57836040517f9996b3150000000000000000000000000000000000000000000000000000000081526004016102339190610536565b60405180910390fd5b5f61024b6102f760201b60201c565b11156102645761025f61031b60201b60201c565b610296565b6040517fd6bda27500000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b505b92915050565b5f3411156102d8576040517fb398979f00000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b565b5f819050919050565b5f5f5f835160208501865af4905092915050565b5f3d905090565b606060405190503d81523d5f602083013e3d602001810160405290565b6040513d5f823e3d81fd5b5f604051905090565b5f5ffd5b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f61036082610337565b9050919050565b61037081610356565b811461037a575f5ffd5b50565b5f8151905061038b81610367565b92915050565b5f5ffd5b5f5ffd5b5f601f19601f8301169050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b6103df82610399565b810181811067ffffffffffffffff821117156103fe576103fd6103a9565b5b80604052505050565b5f610410610326565b905061041c82826103d6565b919050565b5f67ffffffffffffffff82111561043b5761043a6103a9565b5b61044482610399565b9050602081019050919050565b8281835e5f83830152505050565b5f61047161046c84610421565b610407565b90508281526020810184848401111561048d5761048c610395565b5b610498848285610451565b509392505050565b5f82601f8301126104b4576104b3610391565b5b81516104c484826020860161045f565b91505092915050565b5f5f604083850312156104e3576104e261032f565b5b5f6104f08582860161037d565b925050602083015167ffffffffffffffff81111561051157610510610333565b5b61051d858286016104a0565b9150509250929050565b61053081610356565b82525050565b5f6020820190506105495f830184610527565b92915050565b60d48061055b5f395ff3fe6080604052600a600c565b005b60186014601a565b6026565b565b5f60216044565b905090565b365f5f375f5f365f845af43d5f5f3e805f81146040573d5ff35b3d5ffd5b5f606e7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5f1b6095565b5f015f9054906101000a900473ffffffffffffffffffffffffffffffffffffffff16905090565b5f81905091905056fea26469706673582212204505a31d6eb39dd16c80eec772ed5336baa28cec74133b7d8db8bd46dd124a9664736f6c634300081e0033" as `0x${string}`;

export interface DelegatedAccountConfig {
  owner: Address;
  operator: Address;
  exchange: Address;
  collateralToken: Address;
}

export interface DelegatedAccountState {
  owner: Address;
  accountId: bigint;
  exchange: Address;
  collateralToken: Address;
}

/**
 * DelegatedAccount contract wrapper
 */
export class DelegatedAccount {
  public readonly address: Address;
  private readonly publicClient: PublicClient;
  private readonly walletClient?: WalletClient;

  constructor(
    address: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient
  ) {
    this.address = address;
    this.publicClient = publicClient;
    this.walletClient = walletClient;
  }

  /**
   * Deploy a new DelegatedAccount proxy
   * @param implementationAddress Address of the DelegatedAccount implementation
   * @param config Configuration for the delegated account
   * @param publicClient Public client for reading
   * @param walletClient Wallet client for deployment
   * @returns Deployed DelegatedAccount instance
   */
  static async deploy(
    implementationAddress: Address,
    config: DelegatedAccountConfig,
    publicClient: PublicClient,
    walletClient: WalletClient
  ): Promise<{ delegatedAccount: DelegatedAccount; txHash: Hash }> {
    const account = walletClient.account;
    if (!account) {
      throw new Error("Wallet client must have an account");
    }

    // Encode initialization data
    const initData = encodeFunctionData({
      abi: DelegatedAccountAbi,
      functionName: "initialize",
      args: [
        config.owner,
        config.operator,
        config.exchange,
        config.collateralToken,
      ],
    });

    // Deploy ERC1967 proxy with implementation and init data
    const deployData = encodeDeployData({
      abi: [
        {
          type: "constructor",
          inputs: [
            { name: "implementation", type: "address" },
            { name: "_data", type: "bytes" },
          ],
          stateMutability: "payable",
        },
      ],
      bytecode: ERC1967_PROXY_BYTECODE,
      args: [implementationAddress, initData],
    });

    // Get nonce for address calculation
    const nonce = await publicClient.getTransactionCount({
      address: account.address,
    });

    // Calculate deployed address
    const proxyAddress = getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    });

    // Send deployment transaction
    const txHash = await walletClient.sendTransaction({
      account,
      data: deployData,
      chain: walletClient.chain,
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return {
      delegatedAccount: new DelegatedAccount(
        proxyAddress,
        publicClient,
        walletClient
      ),
      txHash,
    };
  }

  /**
   * Connect to an existing DelegatedAccount
   */
  static connect(
    address: Address,
    publicClient: PublicClient,
    walletClient?: WalletClient
  ): DelegatedAccount {
    return new DelegatedAccount(address, publicClient, walletClient);
  }

  // ============ Read Functions ============

  /**
   * Get the owner address
   */
  async getOwner(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "owner",
    }) as Promise<Address>;
  }

  /**
   * Check if an address is an operator
   */
  async isOperator(address: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "isOperator",
      args: [address],
    }) as Promise<boolean>;
  }

  /**
   * Get the exchange address
   */
  async getExchange(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "exchange",
    }) as Promise<Address>;
  }

  /**
   * Get the collateral token address
   */
  async getCollateralToken(): Promise<Address> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "collateralToken",
    }) as Promise<Address>;
  }

  /**
   * Get the exchange account ID
   */
  async getAccountId(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "accountId",
    }) as Promise<bigint>;
  }

  /**
   * Check if a function selector is allowed for operators
   */
  async isOperatorAllowed(selector: `0x${string}`): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "operatorAllowlist",
      args: [selector],
    }) as Promise<boolean>;
  }

  /**
   * Get the collateral token balance of this contract
   */
  async getCollateralBalance(): Promise<bigint> {
    const token = await this.getCollateralToken();
    return this.publicClient.readContract({
      address: token,
      abi: ERC20Abi,
      functionName: "balanceOf",
      args: [this.address],
    }) as Promise<bigint>;
  }

  /**
   * Get full state of the delegated account
   */
  async getState(): Promise<DelegatedAccountState> {
    const [owner, accountId, exchange, collateralToken] = await Promise.all([
      this.getOwner(),
      this.getAccountId(),
      this.getExchange(),
      this.getCollateralToken(),
    ]);

    return { owner, accountId, exchange, collateralToken };
  }

  // ============ Owner Functions ============

  private ensureWalletClient(): WalletClient {
    if (!this.walletClient) {
      throw new Error("Wallet client required for write operations");
    }
    return this.walletClient;
  }

  /**
   * Add an operator (owner only)
   */
  async addOperator(operatorAddress: Address): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "addOperator",
      args: [operatorAddress],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Remove an operator (owner only)
   */
  async removeOperator(operatorAddress: Address): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "removeOperator",
      args: [operatorAddress],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Update operator allowlist (owner only)
   */
  async setOperatorAllowlist(
    selector: `0x${string}`,
    allowed: boolean
  ): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "setOperatorAllowlist",
      args: [selector, allowed],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Create an exchange account with initial deposit (owner only)
   * Contract must have collateral tokens before calling
   */
  async createAccount(amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "createAccount",
      args: [amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Withdraw collateral from exchange to owner (owner only)
   */
  async withdrawCollateral(amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "withdrawCollateral",
      args: [amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Rescue ERC20 tokens from contract (owner only)
   */
  async rescueTokens(token: Address, amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "rescueTokens",
      args: [token, amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Set exchange approval for collateral token (owner only)
   */
  async setExchangeApproval(amount: bigint): Promise<Hash> {
    const walletClient = this.ensureWalletClient();
    const account = walletClient.account;
    if (!account) throw new Error("Wallet client must have an account");

    return walletClient.writeContract({
      address: this.address,
      abi: DelegatedAccountAbi,
      functionName: "setExchangeApproval",
      args: [amount],
      account,
      chain: walletClient.chain,
    });
  }

  /**
   * Parse AccountCreated events from a transaction receipt
   */
  parseAccountCreatedEvent(
    logs: readonly { topics: readonly string[]; data: string }[]
  ): bigint | null {
    const parsed = parseEventLogs({
      abi: DelegatedAccountAbi,
      eventName: "AccountCreated",
      logs: logs as any,
    });

    if (parsed.length > 0) {
      return parsed[0].args.accountId;
    }
    return null;
  }
}
