import { useConnection } from '@jup-ag/wallet-adapter';
import { AccountLayout, TOKEN_PROGRAM_ID, Token, AccountInfo as TokenAccountInfo, u64 } from '@solana/spl-token';
import { AccountInfo, PublicKey } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';
import BN from 'bn.js';
import React, { PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { WRAPPED_SOL_MINT } from 'src/constants';
import { fromLamports, getAssociatedTokenAddressSync } from 'src/misc/utils';
import { useWalletPassThrough } from './WalletPassthroughProvider';
import { useTokenContext } from './TokenContextProvider';
import { checkIsToken2022, getMultipleAccountsInfo } from './utils';
import Decimal from 'decimal.js';

const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export interface IAccountsBalance {
  pubkey: PublicKey;
  balance: number;
  balanceLamports: BN;
  hasBalance: boolean;
  decimals: number;
}

interface IAccountContext {
  accounts: Record<string, IAccountsBalance>;
  loading: boolean;
  refresh: () => void;
  fetchAllTokens: () => void;
  fetchTokenAccounts: (mintsOrAccounts: (string | PublicKey)[]) => void;
}

interface ParsedTokenData {
  account: {
    data: {
      parsed: {
        info: {
          isNative: boolean;
          mint: string;
          owner: string;
          state: string;
          tokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number;
            uiAmountString: string;
          };
        };
        type: string;
      };
      program: string;
      space: number;
    };
    executable: boolean;
    lamports: number;
    owner: PublicKey;
    rentEpoch?: number;
  };
  pubkey: PublicKey;
}

const AccountContext = React.createContext<IAccountContext>({
  accounts: {},
  loading: true,
  refresh: () => {},
  fetchAllTokens: () => {},
  fetchTokenAccounts: () => {},
});

export interface TokenAccount {
  pubkey: PublicKey;
  account: AccountInfo<Buffer>;
  info: TokenAccountInfo;
}

export function wrapNativeAccount(pubkey: PublicKey, account: AccountInfo<Buffer>): TokenAccount | undefined {
  if (!account) {
    return undefined;
  }

  return {
    pubkey: pubkey,
    account,
    info: {
      address: pubkey,
      mint: WRAPPED_SOL_MINT,
      owner: pubkey,
      amount: new u64(account.lamports.toString()),
      delegate: null,
      delegatedAmount: new u64(0),
      isInitialized: true,
      isFrozen: false,
      isNative: true,
      rentExemptReserve: null,
      closeAuthority: null,
    },
  };
}

const deserializeAccount = (data: Buffer) => {
  if (data == undefined || data.length == 0) {
    return undefined;
  }
  const accountInfo = AccountLayout.decode(data);
  accountInfo.mint = new PublicKey(accountInfo.mint);
  accountInfo.owner = new PublicKey(accountInfo.owner);
  accountInfo.amount = u64.fromBuffer(accountInfo.amount);
  if (accountInfo.delegateOption === 0) {
    accountInfo.delegate = null;
    accountInfo.delegatedAmount = new u64(0);
  } else {
    accountInfo.delegate = new PublicKey(accountInfo.delegate);
    accountInfo.delegatedAmount = u64.fromBuffer(accountInfo.delegatedAmount);
  }
  accountInfo.isInitialized = accountInfo.state !== 0;
  accountInfo.isFrozen = accountInfo.state === 2;
  if (accountInfo.isNativeOption === 1) {
    accountInfo.rentExemptReserve = u64.fromBuffer(accountInfo.isNative);
    accountInfo.isNative = true;
  } else {
    accountInfo.rentExemptReserve = null;
    accountInfo.isNative = false;
  }
  if (accountInfo.closeAuthorityOption === 0) {
    accountInfo.closeAuthority = null;
  } else {
    accountInfo.closeAuthority = new PublicKey(accountInfo.closeAuthority);
  }
  return accountInfo;
};

export const TokenAccountParser = (pubkey: PublicKey, info: AccountInfo<Buffer>): TokenAccount | undefined => {
  const tokenAccountInfo = deserializeAccount(info.data);

  if (!tokenAccountInfo) return;
  return {
    pubkey,
    account: info,
    info: tokenAccountInfo,
  };
};

const AccountsProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const { publicKey, connected } = useWalletPassThrough();
  const { connection } = useConnection();
  const { tokenMap } = useTokenContext();

  const fetchNative = useCallback(async () => {
    if (!publicKey || !connected) return null;

    const response = await connection.getAccountInfo(publicKey);
    if (response) {
      return {
        pubkey: publicKey,
        balance: fromLamports(response?.lamports || 0, 9),
        balanceLamports: new BN(response?.lamports || 0),
        hasBalance: response?.lamports ? response?.lamports > 0 : false,
        decimals: 9,
      };
    }
  }, [publicKey, connected]);

  const cacheKey = useMemo(
    () => [connection.rpcEndpoint, publicKey?.toString() || ''],
    [connection.rpcEndpoint, publicKey?.toString()],
  );

  const hasRequestedAllToken = useRef(false);
  const [tokenOrMintAccountsToFetch, setTokenOrMintAccountsToFetch] = useState<(string | PublicKey)[]>([]);
  const {
    refetch: fetchTokenAccounts,
    data: fetchedAtaToUserAccount,
    isLoading: isFetchingTokenAcounts,
    // variables,
    remove,
  } = useQuery(
    ['specific-token-accounts', ...cacheKey, tokenOrMintAccountsToFetch.map((t) => t.toString()).join()],
    async () => {
      const mintsOrAccounts = tokenOrMintAccountsToFetch;
      if (!publicKey) {
        return new Map<string, TokenAccount>();
      }
      const atasSet = mintsOrAccounts.reduce((atas, mintOrAta) => {
        const mintStr = mintOrAta.toString();
        const tokenInfo = tokenMap.get(mintStr);
        if (tokenInfo) {
          const isToken2022 = checkIsToken2022(tokenInfo);
          const tokenAta = getAssociatedTokenAddressSync(
            new PublicKey(mintStr),
            publicKey!,
            isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID,
          );
          atas.add(tokenAta.toString());
        } else {
          // could be ATA
          atas.add(mintOrAta.toString());
        }

        return atas;
      }, new Set<string>());
      const atas = Array.from(atasSet).map((ata) => new PublicKey(ata));
      const accountToAccountInfosMap = await getMultipleAccountsInfo(connection, atas);
      const ataToTokenAccountMap = Array.from(accountToAccountInfosMap).reduce(
        (_ataToTokenAccountMap, [pubkey, account]) => {
          if (!account) return _ataToTokenAccountMap;
          const tokenAccount = TokenAccountParser(new PublicKey(pubkey), account);
          if (tokenAccount) {
            _ataToTokenAccountMap.set(pubkey, tokenAccount);
          }
          return _ataToTokenAccountMap;
        },
        new Map<string, TokenAccount>(),
      );
      return ataToTokenAccountMap;
    },
    {
      initialData: new Map<string, TokenAccount>(),
      enabled: tokenOrMintAccountsToFetch.length > 0 && hasRequestedAllToken.current === false,
      refetchInterval: 10_000,
    },
  );

  const fetchAllTokens = useCallback(async () => {
    if (!publicKey || !connected) return {};

    hasRequestedAllToken.current = true;

    const [tokenAccounts, token2022Accounts] = await Promise.all(
      [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((tokenProgramId) =>
        connection.getParsedTokenAccountsByOwner(publicKey, { programId: tokenProgramId }, 'confirmed'),
      ),
    );

    const reducedResult = [...tokenAccounts.value, ...token2022Accounts.value].reduce(
      (acc, item: ParsedTokenData) => {
        // Only allow standard TOKEN_PROGRAM_ID ATA
        const expectedAta = getAssociatedTokenAddressSync(new PublicKey(item.account.data.parsed.info.mint), publicKey);
        if (!expectedAta.equals(item.pubkey)) return acc;

        acc[item.account.data.parsed.info.mint] = {
          balance: item.account.data.parsed.info.tokenAmount.uiAmount,
          balanceLamports: new BN(0),
          pubkey: item.pubkey,
          hasBalance: item.account.data.parsed.info.tokenAmount.uiAmount > 0,
          decimals: item.account.data.parsed.info.tokenAmount.decimals,
        };
        return acc;
      },
      {} as Record<string, IAccountsBalance>,
    );

    return reducedResult;
  }, [publicKey, connected]);

  const {
    data: accounts,
    isLoading,
    refetch,
  } = useQuery<Record<string, IAccountsBalance>>(
    ['accounts', publicKey?.toString(), fetchedAtaToUserAccount.size],
    async () => {
      const nativeAccount = await fetchNative();

      if (hasRequestedAllToken.current === false) {
        const requestedTokenAccounts = [...fetchedAtaToUserAccount].reduce(
          (acc, [key, value]: [string, TokenAccount]) => {
            const balance = value.info.amount.toNumber();
            const tokenInfo = tokenMap.get(value.info.mint.toString());

            return {
              ...acc,
              [value.info.mint.toString()]: {
                balance: new Decimal(balance).div(10 ** (tokenInfo?.decimals || 0)).toNumber(),
                balanceLamports: new BN(balance),
                pubkey: value.pubkey,
                hasBalance: value.info.amount.toNumber() > 0,
                decimals: tokenInfo?.decimals || 0,
              },
            };
          },
          {},
        );

        return nativeAccount
          ? {
              [WRAPPED_SOL_MINT.toString()]: nativeAccount,
              ...requestedTokenAccounts,
            }
          : requestedTokenAccounts;
      }

      // Fetch all tokens balance
      const accounts = await fetchAllTokens();
      return {
        ...accounts,
        ...(nativeAccount ? { [WRAPPED_SOL_MINT.toString()]: nativeAccount } : {}),
      };
    },
    {
      enabled: Boolean(publicKey?.toString() && connected),
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
      // Aggresively cache this, so multiple calls won't trigger multiple fetches
      keepPreviousData: true,
    },
  );

  return (
    <AccountContext.Provider
      value={{
        accounts: accounts || {},
        loading: isLoading || isFetchingTokenAcounts,
        refresh: useCallback(() => {
          if (hasRequestedAllToken.current === false) {
            fetchTokenAccounts();
          } else {
            refetch();
          }
        }, []),
        fetchAllTokens: useCallback(() => {
          hasRequestedAllToken.current = true;
          refetch();
        }, []),
        fetchTokenAccounts: useCallback(
          (tokenOrMintAccountsToFetch) => {
            const filteredTokenAccounts = tokenOrMintAccountsToFetch?.filter(Boolean);
            if (filteredTokenAccounts) {
              setTokenOrMintAccountsToFetch(filteredTokenAccounts);
            }
          },
          [setTokenOrMintAccountsToFetch],
        ),
      }}
    >
      {children}
    </AccountContext.Provider>
  );
};

const useAccounts = () => {
  return useContext(AccountContext);
};

export { AccountsProvider, useAccounts };
