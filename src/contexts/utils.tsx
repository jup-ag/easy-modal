import { TokenInfo } from "@solana/spl-token-registry";
import { AccountInfo, Connection, GetMultipleAccountsConfig, PublicKey } from "@solana/web3.js";
import { splitIntoChunks } from "src/misc/utils";

export const checkIsToken2022 = (tokenInfo: TokenInfo) => {
  return tokenInfo.tags?.includes('token-2022');
};

export const getMultipleAccountsInfo = async (
  connection: Connection,
  keys: PublicKey[],
  options?: GetMultipleAccountsConfig,
) => {
  const accountToAccountInfoMap = new Map<string, AccountInfo<Buffer> | null>();
  await Promise.all(
    splitIntoChunks(keys, 99).map(async (chunk) => {
      const accountInfos = await connection.getMultipleAccountsInfo(chunk, options);
      accountInfos.forEach((accountInfo, idx) => {
        accountToAccountInfoMap.set(chunk[idx].toString(), accountInfo);
      });

      return;
    }),
  );

  return accountToAccountInfoMap;
};
