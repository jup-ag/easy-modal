import { MouseEvent, useCallback, useEffect, useMemo } from 'react';
import { NumberFormatValues, NumericFormat } from 'react-number-format';

import { useAccounts } from '../contexts/accounts';

import { MAX_INPUT_LIMIT, MINIMUM_SOL_BALANCE } from '../misc/constants';

import CoinBalance from './Coinbalance';
import FormError from './FormError';
import JupButton from './JupButton';

import TokenIcon from './TokenIcon';

import { WRAPPED_SOL_MINT } from '../constants';
import { useSwapContext } from 'src/contexts/SwapContext';
import useTimeDiff from './useTimeDiff/useTimeDiff';
import { useWalletPassThrough } from 'src/contexts/WalletPassthroughProvider';
import WalletIcon from 'src/icons/WalletIcon';
import ChevronDownIcon from 'src/icons/ChevronDownIcon';
import PriceInfo from './PriceInfo/index';
import { RoutesSVG } from 'src/icons/RoutesSVG';
import SwitchPairButton from './SwitchPairButton';
import { SwapMode } from '@jup-ag/react-hook';
import classNames from 'classnames';
import { detectedSeparator } from 'src/misc/utils';
import CoinBalanceUSD from './CoinBalanceUSD';
import { UnifiedWalletButton } from '@jup-ag/wallet-adapter';
import V2SexyChameleonText from './SexyChameleonText/V2SexyChameleonText';

const Form: React.FC<{
  onSubmit: () => void;
  isDisabled: boolean;
  setSelectPairSelector: React.Dispatch<React.SetStateAction<'fromMint' | 'toMint' | null>>;
  setIsWalletModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = ({ onSubmit, isDisabled, setSelectPairSelector, setIsWalletModalOpen }) => {
  const { publicKey } = useWalletPassThrough();
  const { accounts, fetchAllTokens } = useAccounts();
  const {
    form,
    setForm,
    errors,
    fromTokenInfo,
    toTokenInfo,
    quoteResponseMeta,
    formProps: { swapMode, fixedAmount, fixedInputMint, fixedOutputMint },
    jupiter: { quoteResponseMeta: route, loading, error, refresh },
  } = useSwapContext();
  const [hasExpired, timeDiff] = useTimeDiff();
  useEffect(() => {
    if (hasExpired) {
      refresh();
    }
  }, [hasExpired]);

  const walletPublicKey = useMemo(() => publicKey?.toString(), [publicKey]);

  const onChangeFromValue = (value: string) => {
    if (value === '') {
      setForm((form) => ({ ...form, fromValue: '', toValue: '' }));
      return;
    }

    const isInvalid = Number.isNaN(value);
    if (isInvalid) return;

    setForm((form) => ({ ...form, fromValue: value }));
  };

  const onChangeToValue = (value: string) => {
    if (value === '') {
      setForm((form) => ({ ...form, fromValue: '', toValue: '' }));
      return;
    }

    const isInvalid = Number.isNaN(value);
    if (isInvalid) return;

    setForm((form) => ({ ...form, toValue: value }));
  };

  const balance = useMemo(() => {
    return fromTokenInfo ? accounts[fromTokenInfo.address]?.balance || 0 : 0;
  }, [accounts, fromTokenInfo]);

  const onClickMax = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();

      if (!balance || swapMode === 'ExactOut') return;

      if (fromTokenInfo?.address === WRAPPED_SOL_MINT.toBase58()) {
        setForm((prev) => ({
          ...prev,
          fromValue: String(balance > MINIMUM_SOL_BALANCE ? (balance - MINIMUM_SOL_BALANCE).toFixed(6) : 0),
        }));
      } else {
        setForm((prev) => ({
          ...prev,
          fromValue: String(balance),
        }));
      }
    },
    [balance, fromTokenInfo],
  );

  const onClickSwitchPair = () => {
    setForm((prev) => ({
      ...prev,
      fromValue: '',
      toValue: '',
      fromMint: prev.toMint,
      toMint: prev.fromMint,
    }));
  };

  const hasFixedMint = useMemo(() => fixedInputMint || fixedOutputMint, [fixedInputMint, fixedOutputMint]);
  const { inputAmountDisabled } = useMemo(() => {
    const result = { inputAmountDisabled: true, outputAmountDisabled: true };
    if (!fixedAmount) {
      if (swapMode === SwapMode.ExactOut) {
        result.outputAmountDisabled = false;
      } else {
        result.inputAmountDisabled = false;
      }
    }
    return result;
  }, [fixedAmount, swapMode]);

  const marketRoutes = quoteResponseMeta
    ? quoteResponseMeta.quoteResponse.routePlan.map(({ swapInfo }) => swapInfo.label).join(', ')
    : '';

  const onClickSelectFromMint = useCallback(() => {
    if (fixedInputMint) return;
    setSelectPairSelector('fromMint');
    fetchAllTokens();
  }, [fixedInputMint]);

  const onClickSelectToMint = useCallback(() => {
    if (fixedOutputMint) return;
    setSelectPairSelector('toMint');
    fetchAllTokens();
  }, [fixedOutputMint]);

  const fixedOutputFomMintClass = useMemo(() => {
    if (swapMode === 'ExactOut' && !form.toValue) return 'opacity-20 hover:opacity-100';
    return '';
  }, [fixedOutputMint, form.toValue]);

  const thousandSeparator = useMemo(() => (detectedSeparator === ',' ? '.' : ','), []);
  // Allow empty input, and input lower than max limit
  const withValueLimit = useCallback(
    ({ floatValue }: NumberFormatValues) => !floatValue || floatValue <= MAX_INPUT_LIMIT,
    [],
  );

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (window.Jupiter.enableWalletPassthrough && window.Jupiter.onRequestConnectWallet) {
      window.Jupiter.onRequestConnectWallet();
    } else {
      setIsWalletModalOpen(true);
    }
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center pb-4">
      <div className="w-full mt-2 rounded-xl flex flex-col px-2">
        <div className="flex-col">
          <div
            className={classNames(
              'border-b border-transparent bg-[#212128] rounded-xl transition-all',
              fixedOutputFomMintClass,
            )}
          >
            <div className={classNames('px-x border-transparent rounded-xl ')}>
              <div>
                <div className={classNames('py-5 px-4 flex flex-col dark:text-white')}>
                  <div className="flex justify-between items-center">
                    <button
                      type="button"
                      className="py-2 px-3 rounded-2xl flex items-center bg-[#36373E] hover:bg-white/20 text-white"
                      disabled={fixedInputMint}
                      onClick={onClickSelectFromMint}
                    >
                      <div className="h-5 w-5">
                        <TokenIcon tokenInfo={fromTokenInfo} width={20} height={20} />
                      </div>
                      <div className="ml-4 mr-2 font-semibold" translate="no">
                        {fromTokenInfo?.symbol}
                      </div>
                      {fixedInputMint ? null : (
                        <span className="text-white/25 fill-current">
                          <ChevronDownIcon />
                        </span>
                      )}
                    </button>

                    <div className="text-right">
                      <NumericFormat
                        disabled={swapMode === 'ExactOut'}
                        value={typeof form.fromValue === 'undefined' ? '' : form.fromValue}
                        decimalScale={fromTokenInfo?.decimals}
                        thousandSeparator={thousandSeparator}
                        allowNegative={false}
                        valueIsNumericString
                        onValueChange={({ value }) => onChangeFromValue(value)}
                        placeholder={'0.00'}
                        className={classNames(
                          'h-full w-full bg-transparent text-white text-right font-semibold text-lg',
                          { 'cursor-not-allowed': inputAmountDisabled },
                        )}
                        decimalSeparator={detectedSeparator}
                        isAllowed={withValueLimit}
                      />
                    </div>
                  </div>

                  {fromTokenInfo?.address ? (
                    <div className="flex justify-between items-center">
                      <div
                        className={classNames('flex mt-3 space-x-1 text-xs items-center text-white/30 fill-current', {
                          'cursor-pointer': swapMode !== 'ExactOut',
                        })}
                        onClick={onClickMax}
                      >
                        <WalletIcon width={10} height={10} />
                        <CoinBalance mintAddress={fromTokenInfo.address} />
                        <span>{fromTokenInfo.symbol}</span>
                      </div>

                      {form.fromValue ? (
                        <span className="text-xs text-white/30">
                          <CoinBalanceUSD tokenInfo={fromTokenInfo} amount={form.fromValue} />
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className={'my-2'}>
            {hasFixedMint ? null : (
              <SwitchPairButton
                onClick={onClickSwitchPair}
                className={classNames('transition-all', fixedOutputFomMintClass)}
              />
            )}
          </div>

          <div className="border-b border-transparent bg-[#212128] rounded-xl">
            <div className="px-x border-transparent rounded-xl">
              <div>
                <div className="py-5 px-4 flex flex-col dark:text-white">
                  <div className="flex justify-between items-center">
                    <button
                      type="button"
                      className="py-2 px-3 rounded-2xl flex items-center bg-[#36373E] hover:bg-white/20 disabled:hover:bg-[#36373E] text-white"
                      disabled={fixedOutputMint}
                      onClick={onClickSelectToMint}
                    >
                      <div className="h-5 w-5">
                        <TokenIcon tokenInfo={toTokenInfo} width={20} height={20} />
                      </div>
                      <div className="ml-4 mr-2 font-semibold" translate="no">
                        {toTokenInfo?.symbol}
                      </div>

                      {fixedOutputMint ? null : (
                        <span className="text-white/25 fill-current">
                          <ChevronDownIcon />
                        </span>
                      )}
                    </button>

                    <div className="text-right">
                      <NumericFormat
                        disabled={!swapMode || swapMode === 'ExactIn'}
                        value={typeof form.toValue === 'undefined' ? '' : form.toValue}
                        decimalScale={toTokenInfo?.decimals}
                        thousandSeparator={thousandSeparator}
                        allowNegative={false}
                        valueIsNumericString
                        onValueChange={({ value }) => onChangeToValue(value)}
                        placeholder={swapMode === 'ExactOut' ? 'Enter desired amount' : ''}
                        className={classNames(
                          'h-full w-full bg-transparent text-white text-right font-semibold  placeholder:text-sm placeholder:font-normal text-lg',
                        )}
                        decimalSeparator={detectedSeparator}
                        isAllowed={withValueLimit}
                      />
                    </div>
                  </div>

                  {toTokenInfo?.address ? (
                    <div className="flex justify-between items-center">
                      <div className="flex mt-3 space-x-1 text-xs items-center text-white/30 fill-current">
                        <WalletIcon width={10} height={10} />
                        <CoinBalance mintAddress={toTokenInfo.address} />
                        <span>{toTokenInfo.symbol}</span>
                      </div>

                      {form.toValue ? (
                        <span className="text-xs text-white/30">
                          <CoinBalanceUSD tokenInfo={toTokenInfo} amount={form.toValue} />
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {route?.quoteResponse ? (
            <div className="flex items-center mt-2 text-xs space-x-1">
              <div className="bg-black/20 rounded-xl px-2 py-1 text-white/50 flex items-center space-x-1">
                <RoutesSVG width={7} height={9} />
              </div>
              <span className="text-white/30">using</span>
              <span className="text-white/50 overflow-hidden whitespace-nowrap text-ellipsis max-w-[70%]">
                {marketRoutes}
              </span>
            </div>
          ) : null}
        </div>

        {walletPublicKey ? <FormError errors={errors} /> : null}
      </div>

      <div className="w-full px-2">
        {!walletPublicKey ? (
          <UnifiedWalletButton
            buttonClassName="!bg-transparent"
            overrideContent={
              <JupButton size="lg" className="w-full mt-4" type="button" onClick={handleClick}>
                Connect Wallet
              </JupButton>
            }
          />
        ) : (
          <JupButton
            size="lg"
            className="w-full mt-4 disabled:opacity-50"
            type="button"
            onClick={onSubmit}
            disabled={isDisabled || loading}
          >
            {loading ? (
              <span className="text-sm">Loading...</span>
            ) : error ? (
              <span className="text-sm">Error fetching route. Try changing your input</span>
            ) : (
              <V2SexyChameleonText>Swap</V2SexyChameleonText>
            )}
          </JupButton>
        )}

        {route && quoteResponseMeta && fromTokenInfo && toTokenInfo ? (
          <PriceInfo
            quoteResponse={quoteResponseMeta.quoteResponse}
            fromTokenInfo={fromTokenInfo}
            toTokenInfo={toTokenInfo}
            loading={loading}
          />
        ) : null}
      </div>
    </div>
  );
};

export default Form;
