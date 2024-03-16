import { ZERO } from '@jup-ag/math';
import { OnTransaction, QuoteResponseMeta, SwapMode, SwapResult, useJupiter } from '@jup-ag/react-hook';
import { TokenInfo } from '@solana/spl-token-registry';
import { PublicKey } from '@solana/web3.js';
import Decimal from 'decimal.js';
import JSBI from 'jsbi';
import {
  createContext,
  Dispatch,
  FC,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { WRAPPED_SOL_MINT } from 'src/constants';
import { fromLamports, getAssociatedTokenAddressSync, toLamports } from 'src/misc/utils';
import { FormProps, IInit, IOnRequestIxCallback } from 'src/types';
import { useAccounts } from './accounts';
import { useSlippageConfig } from './SlippageConfigProvider';
import { useTokenContext } from './TokenContextProvider';
import { useWalletPassThrough } from './WalletPassthroughProvider';
import { SignerWalletAdapter } from '@jup-ag/wallet-adapter';
import { useScreenState } from './ScreenProvider';

export interface IForm {
  fromMint: string;
  toMint: string;
  fromValue: string;
  toValue: string;
}

export interface ISwapContext {
  form: IForm;
  setForm: Dispatch<SetStateAction<IForm>>;
  errors: Record<string, { title: string; message: string }>;
  setErrors: Dispatch<
    SetStateAction<
      Record<
        string,
        {
          title: string;
          message: string;
        }
      >
    >
  >;
  fromTokenInfo?: TokenInfo | null;
  toTokenInfo?: TokenInfo | null;
  quoteResponseMeta: QuoteResponseMeta | null;
  setQuoteResponseMeta: Dispatch<SetStateAction<QuoteResponseMeta | null>>;
  onSubmit: () => Promise<SwapResult | null>;
  onRequestIx: () => Promise<IOnRequestIxCallback>;
  lastSwapResult: { swapResult: SwapResult; quoteResponseMeta: QuoteResponseMeta | null } | null;
  formProps: FormProps;
  displayMode: IInit['displayMode'];
  scriptDomain: IInit['scriptDomain'];
  swapping: {
    txStatus:
      | {
          txid: string;
          status: 'loading' | 'fail' | 'success';
        }
      | undefined;
  };
  reset: (props?: { resetValues: boolean }) => void;
  jupiter: Omit<ReturnType<typeof useJupiter>, 'exchange' | 'quoteResponseMeta'> & {
    exchange: ReturnType<typeof useJupiter>['exchange'] | undefined;
    asLegacyTransaction: boolean;
    setAsLegacyTransaction: Dispatch<SetStateAction<boolean>>;
    priorityFeeInSOL: number;
    setPriorityFeeInSOL: Dispatch<SetStateAction<number>>;
    quoteResponseMeta: QuoteResponseMeta | undefined | null;
  };
}

export const initialSwapContext: ISwapContext = {
  form: {
    fromMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    toMint: WRAPPED_SOL_MINT.toString(),
    fromValue: '',
    toValue: '',
  },
  setForm() {},
  errors: {},
  setErrors() {},
  fromTokenInfo: undefined,
  toTokenInfo: undefined,
  quoteResponseMeta: null,
  setQuoteResponseMeta() {},
  onSubmit: async () => null,
  onRequestIx: async () => {
    throw new Error('Not initialized yet');
  },
  lastSwapResult: null,
  displayMode: 'modal',
  formProps: {
    swapMode: SwapMode.ExactIn,
    initialAmount: undefined,
    fixedAmount: undefined,
    initialInputMint: undefined,
    fixedInputMint: undefined,
    initialOutputMint: undefined,
    fixedOutputMint: undefined,
  },
  scriptDomain: '',
  swapping: {
    txStatus: undefined,
  },
  reset() {},
  jupiter: {
    programIdsExcluded: new Set(),
    programIdToLabelMap: new Map(),
    setProgramIdsExcluded() {},
    quoteResponseMeta: null,
    exchange: undefined,
    loading: false,
    refresh() {},
    lastRefreshTimestamp: 0,
    error: undefined,
    asLegacyTransaction: false,
    setAsLegacyTransaction() {},
    priorityFeeInSOL: 0,
    setPriorityFeeInSOL() {},
  },
};

export const SwapContext = createContext<ISwapContext>(initialSwapContext);

export function useSwapContext() {
  const context = useContext(SwapContext);

  return context;
}

export const PRIORITY_NONE = 0; // No additional fee
export const PRIORITY_HIGH = 0.000_005; // Additional fee of 1x base fee
export const PRIORITY_TURBO = 0.000_5; // Additional fee of 100x base fee
export const PRIORITY_MAXIMUM_SUGGESTED = 0.01;

export const SwapContextProvider: FC<{
  displayMode: IInit['displayMode'];
  scriptDomain?: string;
  asLegacyTransaction: boolean;
  setAsLegacyTransaction: React.Dispatch<React.SetStateAction<boolean>>;
  formProps?: FormProps;
  maxAccounts?: number;
  children: ReactNode;
}> = (props) => {
  const {
    displayMode,
    scriptDomain,
    asLegacyTransaction,
    setAsLegacyTransaction,
    formProps: originalFormProps,
    maxAccounts,
    children,
  } = props;
  const { screen } = useScreenState();
  const { tokenMap } = useTokenContext();
  const { wallet } = useWalletPassThrough();
  const { refresh: refreshAccount, fetchTokenAccounts } = useAccounts();

  const walletPublicKey = useMemo(() => wallet?.adapter.publicKey?.toString(), [wallet?.adapter.publicKey]);

  const formProps: FormProps = useMemo(
    () => ({ ...initialSwapContext.formProps, ...originalFormProps }),
    [originalFormProps],
  );

  const [form, setForm] = useState<IForm>({
    fromMint: formProps?.initialInputMint ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    toMint: formProps?.initialOutputMint ?? WRAPPED_SOL_MINT.toString(),
    fromValue: '',
    toValue: '',
  });
  const [errors, setErrors] = useState<Record<string, { title: string; message: string }>>({});
  const jupiterSwapMode = useMemo(
    () => (formProps?.swapMode ? SwapMode[formProps?.swapMode] : SwapMode.ExactIn),
    [formProps?.swapMode],
  );

  const fromTokenInfo = useMemo(() => {
    const tokenInfo = form.fromMint ? tokenMap.get(form.fromMint) : null;
    return tokenInfo;
  }, [form.fromMint, tokenMap]);

  const toTokenInfo = useMemo(() => {
    const tokenInfo = form.toMint ? tokenMap.get(form.toMint) : null;
    return tokenInfo;
  }, [form.toMint, tokenMap]);

  // Initial fetch token account
  useEffect(() => {
    fetchTokenAccounts([form.fromMint, form.toMint]);
  }, [form.fromMint, form.toMint]);

  // Set value given initial amount
  const setupInitialAmount = useCallback(() => {
    if (!formProps?.initialAmount || tokenMap.size === 0 || !fromTokenInfo || !toTokenInfo) return;

    const toUiAmount = (mint: string) => {
      const tokenInfo = mint ? tokenMap.get(mint) : undefined;
      if (!tokenInfo) return;
      return String(fromLamports(JSBI.BigInt(formProps.initialAmount ?? 0), tokenInfo.decimals));
    };

    if (jupiterSwapMode === SwapMode.ExactOut) {
      setTimeout(() => {
        setForm((prev) => {
          return { ...prev, toValue: toUiAmount(prev.toMint) ?? '' };
        });
      }, 0);
    } else {
      setTimeout(() => {
        setForm((prev) => ({ ...prev, fromValue: toUiAmount(prev.fromMint) ?? '' }));
      }, 0);
    }
  }, [formProps?.initialAmount, jupiterSwapMode, tokenMap]);

  useEffect(() => {
    setupInitialAmount();
  }, [formProps?.initialAmount, jupiterSwapMode, tokenMap]);

  const nativeAmount = useMemo(() => {
    if (jupiterSwapMode === SwapMode.ExactOut) {
      if (!form.toValue || !toTokenInfo) return JSBI.BigInt(0);
      return toLamports(Number(form.toValue), Number(toTokenInfo.decimals));
    } else {
      if (!form.fromValue || !fromTokenInfo) return JSBI.BigInt(0);
      return toLamports(Number(form.fromValue), Number(fromTokenInfo.decimals));
    }
  }, [form.fromValue, form.fromMint, fromTokenInfo, form.toValue, form.toMint, toTokenInfo, jupiterSwapMode]);

  const { slippage } = useSlippageConfig();

  const amount = useMemo(() => JSBI.BigInt(nativeAmount), [nativeAmount]);
  const {
    quoteResponseMeta: ogQuoteResponseMeta,
    exchange,
    loading: loadingQuotes,
    refresh,
    lastRefreshTimestamp,
    error,
    programIdsExcluded,
    programIdToLabelMap,
    setProgramIdsExcluded,
  } = useJupiter({
    amount,
    inputMint: useMemo(() => (form.fromMint ? new PublicKey(form.fromMint) : PublicKey.default), [form.fromMint]),
    outputMint: useMemo(() => (form.toMint ? new PublicKey(form.toMint) : PublicKey.default), [form.toMint]),
    swapMode: jupiterSwapMode,
    slippageBps: Math.ceil(slippage * 100),
    maxAccounts,
  });
  // Refresh on slippage change
  useEffect(() => refresh(), [slippage]);

  const [quoteResponseMeta, setQuoteResponseMeta] = useState<QuoteResponseMeta | null>(null);
  useEffect(() => {
    if (!ogQuoteResponseMeta) {
      setQuoteResponseMeta(null);
      return;
    }
    // the UI sorts the best route depending on ExactIn or ExactOut
    setQuoteResponseMeta(ogQuoteResponseMeta);
  }, [jupiterSwapMode, ogQuoteResponseMeta]);

  useEffect(() => {
    if (!form.fromValue && !quoteResponseMeta) {
      setForm((prev) => ({ ...prev, fromValue: '', toValue: '' }));
      return;
    }

    setForm((prev) => {
      const newValue = { ...prev };

      let { inAmount, outAmount } = quoteResponseMeta?.quoteResponse || {};
      if (jupiterSwapMode === SwapMode.ExactIn) {
        newValue.toValue = outAmount ? String(fromLamports(outAmount, toTokenInfo?.decimals || 0)) : '';
      } else {
        newValue.fromValue = inAmount ? String(fromLamports(inAmount, fromTokenInfo?.decimals || 0)) : '';
      }
      return newValue;
    });
  }, [quoteResponseMeta, fromTokenInfo, toTokenInfo, jupiterSwapMode]);

  const [txStatus, setTxStatus] = useState<
    | {
        txid: string;
        status: 'loading' | 'fail' | 'success';
      }
    | undefined
  >(undefined);

  const onTransaction: OnTransaction = async (txid, awaiter) => {
    const tx = txStatus?.txid === txid ? txStatus : undefined;
    if (!tx) {
      setTxStatus((prev) => ({ ...prev, txid, status: 'loading' }));
    }

    const success = !((await awaiter) instanceof Error);

    setTxStatus((prev) => {
      const tx = prev?.txid === txid ? prev : undefined;
      if (tx) {
        tx.status = success ? 'success' : 'fail';
      }
      return prev ? { ...prev } : undefined;
    });
  };

  const [lastSwapResult, setLastSwapResult] = useState<ISwapContext['lastSwapResult']>(null);
  const onSubmit = useCallback(async () => {
    if (!walletPublicKey || !wallet?.adapter || !quoteResponseMeta) {
      return null;
    }

    try {
      const swapResult = await exchange({
        wallet: wallet?.adapter as SignerWalletAdapter,
        routeInfo: quoteResponseMeta,
        onTransaction,
        computeUnitPriceMicroLamports,
      });
      console.log({ swapResult });

      setLastSwapResult({ swapResult, quoteResponseMeta: quoteResponseMeta });
      return swapResult;
    } catch (error) {
      console.log('Swap error', error);
      return null;
    }
  }, [walletPublicKey, quoteResponseMeta]);

  const onSubmitWithIx = useCallback(
    (swapResult: SwapResult) => {
      try {
        if ('error' in swapResult) throw swapResult.error;

        if ('txid' in swapResult) {
          console.log({ swapResult });
          setTxStatus({ txid: swapResult.txid, status: 'success' });
          setLastSwapResult({ swapResult, quoteResponseMeta });
        }
      } catch (error) {
        console.log('Swap error', error);
        setTxStatus({ txid: '', status: 'fail' });
        setLastSwapResult({ swapResult, quoteResponseMeta });
      }
    },
    [quoteResponseMeta],
  );

  const onRequestIx = useCallback(async (): Promise<IOnRequestIxCallback> => {
    if (!walletPublicKey || !wallet?.adapter) throw new Error('Missing wallet');
    if (!quoteResponseMeta) throw new Error('Missing quote');

    const inputMint = quoteResponseMeta?.quoteResponse.inputMint;
    const outputMint = quoteResponseMeta?.quoteResponse.outputMint;

    // A direct reference from https://station.jup.ag/docs/apis/swap-api#instructions-instead-of-transaction
    const instructions: IOnRequestIxCallback['instructions'] = await (
      await fetch('https://quote-api.jup.ag/v6/swap-instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quoteResponseMeta.original,
          userPublicKey: walletPublicKey,
          computeUnitPriceMicroLamports,
        }),
      })
    ).json();

    if (!instructions || instructions.error) {
      setErrors({
        'missing-instructions': {
          title: 'Missing instructions',
          message: 'Failed to get swap instructions',
        },
      });

      console.log('Failed to get swap instructions: ', instructions);
      throw new Error('Failed to get swap instructions');
    }

    const [sourceAddress, destinationAddress] = [inputMint, outputMint].map((mint, idx) =>
      getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(walletPublicKey)),
    );

    return {
      meta: {
        sourceAddress,
        destinationAddress,
        quoteResponseMeta,
      },
      instructions,
      onSubmitWithIx,
    };
  }, [walletPublicKey, quoteResponseMeta]);

  const refreshAll = () => {
    refresh();
    refreshAccount();
  };

  const reset = useCallback(
    ({ resetValues } = { resetValues: false }) => {
      if (resetValues) {
        setForm({ ...initialSwapContext.form, ...formProps });
        setupInitialAmount();
      } else {
        setForm((prev) => ({ ...prev, toValue: '' }));
      }

      setQuoteResponseMeta(null);
      setErrors(initialSwapContext.errors);
      setLastSwapResult(initialSwapContext.lastSwapResult);
      setTxStatus(initialSwapContext.swapping.txStatus);
      refreshAccount();
    },
    [setupInitialAmount, form],
  );

  const [priorityFeeInSOL, setPriorityFeeInSOL] = useState<number>(PRIORITY_NONE);
  const computeUnitPriceMicroLamports = useMemo(() => {
    if (priorityFeeInSOL === undefined) return 0;
    return new Decimal(priorityFeeInSOL)
      .mul(10 ** 9) // sol into lamports
      .mul(10 ** 6) // lamports into microlamports
      .div(1_400_000) // divide by CU
      .round()
      .toNumber();
  }, [priorityFeeInSOL]);

  // onFormUpdate callback
  useEffect(() => {
    if (typeof window.Jupiter.onFormUpdate === 'function') {
      window.Jupiter.onFormUpdate(form);
    }
  }, [form]);

  // onFormUpdate callback
  useEffect(() => {
    if (typeof window.Jupiter.onScreenUpdate === 'function') {
      window.Jupiter.onScreenUpdate(screen);
    }
  }, [screen]);

  return (
    <SwapContext.Provider
      value={{
        form,
        setForm,
        errors,
        setErrors,
        fromTokenInfo,
        toTokenInfo,
        quoteResponseMeta,
        setQuoteResponseMeta,
        onSubmit,
        onRequestIx,
        lastSwapResult,
        reset,

        displayMode,
        formProps,
        scriptDomain,
        swapping: {
          txStatus,
        },
        jupiter: {
          quoteResponseMeta: JSBI.GT(amount, ZERO) ? quoteResponseMeta : undefined,
          programIdsExcluded,
          programIdToLabelMap,
          setProgramIdsExcluded,
          exchange,
          loading: loadingQuotes,
          refresh: refreshAll,
          lastRefreshTimestamp,
          error,
          asLegacyTransaction,
          setAsLegacyTransaction,
          priorityFeeInSOL,
          setPriorityFeeInSOL,
        },
      }}
    >
      {children}
    </SwapContext.Provider>
  );
};
