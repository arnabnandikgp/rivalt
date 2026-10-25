import * as sdk from '@rivalt/sdk';

/** An unchanged stamp proves nonexecution only after finalized blockhash expiry.
 * It never proves that an unseen failed transaction paid no network fee. */
export type GroupAuthority = {
  kind:'marginNonce'|'groupSequence'|'groupQuoteEpoch';
  group:string;
  account:string;
  value:string;
};
export function groupAuthorityValue(authority: GroupAuthority, bytes: Buffer): bigint {
  const tagged = (discriminator: Uint8Array | ArrayLike<number>) => {
    if (!bytes.subarray(0,8).equals(Buffer.from(discriminator))) throw new Error('Wrong group authority account schema');
  };
  switch (authority.kind) {
    case 'groupSequence': {
      tagged(sdk.CLEARING_GROUP_V2_DISCRIMINATOR);
      const account = sdk.getClearingGroupV2Decoder().decode(bytes);
      if (account.schemaVersion !== 2 || account.profileVersion !== 2 || authority.account !== authority.group) throw new Error('Group authority binding');
      return account.sequence;
    }
    case 'marginNonce': {
      tagged(sdk.MARGIN_ACCOUNT_V2_DISCRIMINATOR);
      const account = sdk.getMarginAccountV2Decoder().decode(bytes);
      if (account.schemaVersion !== 2 || account.group !== authority.group) throw new Error('Margin authority binding');
      return account.nonce;
    }
    case 'groupQuoteEpoch': {
      tagged(sdk.MAKER_REGISTRATION_V2_DISCRIMINATOR);
      const account = sdk.getMakerRegistrationV2Decoder().decode(bytes);
      if (account.schemaVersion !== 2 || account.group !== authority.group) throw new Error('Maker authority binding');
      return account.quoteEpoch;
    }
  }
}
