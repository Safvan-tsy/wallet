import { useRef } from 'react';

import { FormikHelpers, FormikProps } from 'formik';
import * as yup from 'yup';

import { HIGH_FEE_AMOUNT_BTC } from '@shared/constants';
import { logger } from '@shared/logger';
import { BitcoinSendFormValues } from '@shared/models/form.model';
import { isEmpty } from '@shared/utils';

import { formatPrecisionError } from '@app/common/error-formatters';
import { useDrawers } from '@app/common/hooks/use-drawers';
import { useWalletType } from '@app/common/use-wallet-type';
import {
  btcAddressNetworkValidator,
  btcAddressValidator,
  notCurrentAddressValidator,
} from '@app/common/validation/forms/address-validators';
import {
  btcInsufficientBalanceValidator,
  btcMinimumSpendValidator,
} from '@app/common/validation/forms/amount-validators';
import { btcAmountPrecisionValidator } from '@app/common/validation/forms/currency-validators';
import { btcRecipientAddressOrBnsNameValidator } from '@app/common/validation/forms/recipient-validators';
import { useUpdatePersistedSendFormValues } from '@app/features/popup-send-form-restoration/use-update-persisted-send-form-values';
import { useBitcoinAssetBalance } from '@app/query/bitcoin/address/address.hooks';
import { useCurrentBtcNativeSegwitAccountAddressIndexZero } from '@app/store/accounts/blockchain/bitcoin/native-segwit-account.hooks';
import { useStacksClientUnanchored } from '@app/store/common/api-clients.hooks';
import { useCurrentNetwork } from '@app/store/networks/networks.selectors';

import { useCalculateMaxBitcoinSpend } from '../../family/bitcoin/hooks/use-calculate-max-spend';
import { useSendFormNavigate } from '../../hooks/use-send-form-navigate';
import { useGenerateSignedBitcoinTx } from './use-generate-bitcoin-tx';

export function useBtcSendForm() {
  const formRef = useRef<FormikProps<BitcoinSendFormValues>>(null);

  const currentNetwork = useCurrentNetwork();
  const currentAccountBtcAddress = useCurrentBtcNativeSegwitAccountAddressIndexZero();
  const btcCryptoCurrencyAssetBalance = useBitcoinAssetBalance(currentAccountBtcAddress);
  const { isShowingHighFeeConfirmation, setIsShowingHighFeeConfirmation } = useDrawers();
  const { whenWallet } = useWalletType();
  const sendFormNavigate = useSendFormNavigate();
  const generateTx = useGenerateSignedBitcoinTx();
  const calcMaxSpend = useCalculateMaxBitcoinSpend();
  const { onFormStateChange } = useUpdatePersistedSendFormValues();
  const client = useStacksClientUnanchored();

  return {
    formRef,

    onFormStateChange,

    currentNetwork,

    validationSchema: yup.object({
      amount: yup
        .number()
        .concat(
          btcAmountPrecisionValidator(formatPrecisionError(btcCryptoCurrencyAssetBalance.balance))
        )
        .concat(
          btcInsufficientBalanceValidator({
            // TODO: investigate yup features for cross-field validation
            // to prevent need to access form via ref
            recipient: formRef.current?.values.recipient ?? '',
            calcMaxSpend,
          })
        )
        .concat(btcMinimumSpendValidator()),
      recipientAddressOrBnsName: btcRecipientAddressOrBnsNameValidator({
        client,
      }),
      recipient: yup
        .string()
        .concat(btcAddressValidator())
        .concat(btcAddressNetworkValidator(currentNetwork.chain.bitcoin.network))
        .concat(notCurrentAddressValidator(currentAccountBtcAddress || '')),
    }),

    async previewTransaction(
      values: BitcoinSendFormValues,
      formikHelpers: FormikHelpers<BitcoinSendFormValues>
    ) {
      logger.debug('btc form values', values);
      // Validate and check high fee warning first
      const formErrors = await formikHelpers.validateForm();
      if (
        !isShowingHighFeeConfirmation &&
        isEmpty(formErrors) &&
        values.fee > HIGH_FEE_AMOUNT_BTC
      ) {
        return setIsShowingHighFeeConfirmation(true);
      }

      const resp = generateTx(values);

      if (!resp) return logger.error('Attempted to generate raw tx, but no tx exists');

      const { hex, fee } = resp;

      whenWallet({
        software: () => sendFormNavigate.toConfirmAndSignBtcTransaction(hex, values.recipient, fee),
        ledger: () => {},
      })();
    },
  };
}