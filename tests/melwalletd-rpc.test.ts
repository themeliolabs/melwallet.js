import { describe as _describe, it as _it, expect } from '@jest/globals';
import { is } from 'typescript-is';
// import { get_faucet_confirmation } from '../examples/wait_for_faucet_transaction';
import {
  WalletList,
  PrepareTxArgsHelpers,
  TransactionDump,
  TxBalance,
  TransactionStatus,
  PrepareTxArgs,
} from '../src/types/melwalletd';
import {
  Header,
  NetID,
  CoinData,
  TxKind,
  Transaction,
  PoolState,
  Denom,
} from '../src/types/themelio-structs';
import {
  promise_or_false,
  unwrap_nullable_promise,
  ThemelioJson,
  random_hex_string,
} from '../src/utils/utils';
import { send_faucet, prepare_swap_to } from '../src/utils/wallet-utils';
import {
  MelwalletdClient,
  MelwalletdWallet,
} from '../src/melwalletd-interfaces';
/// ONLY RUN TESTS ON NON-MAINNET UNLESS YOU KNOW WHAT YOU ARE DOING
const NO_MAINNET = true;

/// many of the tests simply run methods with known valid data
/// The library was written using `typescript-is` `assertType` to verify type safety.
/// If calling the method doesn't fail we can assume the defined type has been returned
/// that is enough to give reasonable certainty in program correctness

/// TODO: Improve testing of failures

interface WalletInfo {
  name: string;
  password: string;
}
interface Store {
  wallet_info: WalletInfo;
  client: MelwalletdClient;
  wallet: MelwalletdWallet;
}

// lazy load Store and memoize
// creates a client then creates the test_wallet and builds a `MelwalletdWallet`
const get_store: () => Promise<Store> = (() => {
  const test_wallet_name = 'test_wallet';
  const test_wallet_password = '123';
  const melwalletd_base_url = 'http://127.0.0.1';
  const melwalletd_port = 11773;

  var store: Store;
  var attempts: number = 0;
  expect(attempts).toBeLessThan(2);

  // always returns a store if test passes
  return async () => {
    if (!store) {
      attempts += 1;
      const wallet_info: WalletInfo = {
        name: test_wallet_name,
        password: test_wallet_password,
      };
      const client: MelwalletdClient = new MelwalletdClient(
        melwalletd_base_url,
        melwalletd_port,
      );
      const header: Header = await client.latest_header();

      expect(is<Header>(header)).toBeTruthy(); // melwalletd is running

      if (NO_MAINNET)
        /// fail if not testnet and TESTNET_ONLY
        expect(header.network !== NetID.Mainnet).toBeTruthy();

      try {
        await client.create_wallet(wallet_info.name, wallet_info.password);
      } catch { }
      const wallet: MelwalletdWallet = await unwrap_nullable_promise(
        client.get_wallet(wallet_info.name),
      );
      expect(wallet).toBeTruthy();
      expect(client).toBeTruthy();
      store = { wallet_info, client, wallet: wallet as MelwalletdWallet };
    }
    return store;
  };
})();

describe('Test Basic util features', () => {
  it('bigint.toString', () => {
    let big = 11111111111111111111n;
    expect(big.toString()).toBe('11111111111111111111');
  });
  it('Json.stringify(int) => bigint', () => {
    let big = '[1111111111]';
    let json = ThemelioJson.parse(big) as [bigint];
    expect(json).toStrictEqual([1111111111n]);
  });
});

describe('Initialize Store, end tests otherwise', () => {
  /// initializes the store
  it('Creates Client and MelwalletdWallet', async () => {
    let store = await get_store();
  });
});

describe('Client Features', () => {
  const WALLET_NAMES = [...Array(10).keys()].map(() => random_hex_string(32));

  /// tests for failure of method
  it('tests get_wallet', async () => {
    let { client, wallet_info } = await get_store();
    await client.get_wallet(wallet_info.name);
  });

  /// if this fails, the next test should also fail
  it('create a few different wallets', async () => {
    let { client } = await get_store();
    let created_all_wallets = await Promise.all(
      WALLET_NAMES.map(async (name: string) =>
        client.create_wallet(name, name),
      ),
    )
      .catch(() => false)
      .then(() => true);
    expect(created_all_wallets).toBeTruthy();
  });

  /// compares the created wallets to the list of all wallets
  it('tests list_wallets', async () => {
    let { client } = await get_store();
    let wallets: Set<string> = new Set(await client.list_wallets());

    // check if each wallet_name is contained in the list
    // this should be true for every wallet since every wallet was created in the test above
    let is_wallet_in_list = WALLET_NAMES.map(name => wallets.has(name));

    // if there is even one false, then this whole reduce is false
    // true if all wallets are in the summary
    let all_wallets_in_list = is_wallet_in_list.reduce((r, v) => r && v, true);
    expect(all_wallets_in_list).toBeTruthy();
  });

  /// Get the MEL/SYM pool
  it('tests get_pool', async () => {
    let { client } = await get_store();
    let pool: PoolState | null = await client.melswap_info({
      left: Denom.MEL,
      right: Denom.SYM,
    });
    expect(pool).toBeTruthy();
  });

  /// Get the melwalletd summary
  it('tests get_summary', async () => {
    let { client } = await get_store();
    expect(await client.latest_header());
  });
});

///
describe('Themelio Wallet', () => {
  ///
  it('Unlock the wallet', async () => {
    let store = await get_store();
    let wallet = store.wallet;
    expect(await wallet.unlock(store.wallet_info.password)).toBeTruthy();
  });

  ///
  it('Get wallet summary', async () => {
    let { wallet } = await get_store();
    let summary = await wallet.get_summary();
    expect(summary).toBeTruthy();
  });

  ///
  it('Request the private key', async () => {
    let { wallet, wallet_info } = await get_store();
    let pk = await wallet.export_sk(wallet_info.password);
    expect(typeof pk).toBe('string');
  });

  ///
  it('Try to tap faucet', async () => {
    let { wallet } = await get_store();
    if ((await wallet.get_network()) == NetID.Testnet) {
      let txhash: string = await send_faucet(wallet);

      expect(txhash).toBeTruthy();
    } else {
      expect(true);
    }
  });

  ///
  it('Each balance is a `bigint`', async () => {
    let { wallet } = await get_store();
    let balances: Partial<Record<Denom, bigint>> = await wallet.get_balances();
    Object.entries(balances).forEach(entry => {
      let [denom, value] = entry;
      expect(typeof value).toBe('bigint');
    });
  });

  /// it gets a transaction based on hash
  it('send a transaction and fetch it by hash', async () => {
    let { wallet } = await get_store();
    let txhash: string = await send_faucet(wallet);
    let _tx: TransactionStatus | null = await wallet.tx_status(txhash);
  });

  ///
  it('get all transactions from this wallet', async () => {
    let { wallet, client } = await get_store();
    let dump: TransactionDump = await client.dump_transactions(
      await wallet.get_name(),
    );
  });

  ///
  it('send a transaction and get its txbalance', async () => {
    let { wallet, client } = await get_store();
    let txhash: string = await send_faucet(wallet);
    let tx: TxBalance | null = await client.tx_balance(
      await wallet.get_name(),
      txhash,
    );
  });

  ///
  ///
  it('send a swap transaction', async () => {
    let store = await get_store();
    let { wallet } = store;
    expect(await wallet.unlock(store.wallet_info.password)).toBeTruthy();
    let summary = await wallet.get_summary();
    let decimal_balance = summary.total_micromel % 1_000_000n;
    let untx: PrepareTxArgs = await PrepareTxArgsHelpers.swap(
      await wallet.get_address(),
      Denom.MEL,
      Denom.SYM,
      decimal_balance,
    );
    let tx: Transaction = await wallet.prepare_tx(untx);
    let txhash = await wallet.send_tx(tx);
    expect(txhash).toBeTruthy();
  });

  ///
  ///
  it('simulate a swap transaction', async () => {
    let { client } = await get_store();
    let nfo = await client.simulate_swap(Denom.MEL, Denom.SYM, 1000n);
    expect(nfo);
  });
  /// After testing is complete, lock the wallet
  it('Lock the wallet', async () => {
    let { wallet } = await get_store();
    let summary = await wallet.get_summary();
    expect(summary.locked).toBe(false);
    let locked = await wallet.lock();
    let new_summary = await wallet.get_summary();
    expect(locked).toBe(true);
    expect(new_summary.locked).toBeTruthy();
    expect(new_summary.locked).toEqual(locked);
  });
});

describe.skip('run examples', () => {
  // it('wait for faucet confirmation', get_faucet_confirmation, 60 * 1000);
});
