/** Default price decimals for Perpl (varies per market) */
export const PRICE_DECIMALS = 1n;

/** Default lot decimals for Perpl (varies per market) */
export const LOT_DECIMALS = 5n;

/** Convert price-native-scale to human-readable price */
export function pnsToPrice(pns: bigint, priceDecimals: bigint = PRICE_DECIMALS): number {
  return Number(pns) / Number(10n ** priceDecimals);
}

/** Convert lot-native-scale to human-readable lot size */
export function lnsToLot(lns: bigint, lotDecimals: bigint = LOT_DECIMALS): number {
  return Number(lns) / Number(10n ** lotDecimals);
}

/** Convert ONS (offset-native-scale) price to human price using basePricePNS */
export function onsToPrice(
  ons: bigint,
  basePricePNS: bigint,
  priceDecimals: bigint = PRICE_DECIMALS,
): number {
  return pnsToPrice(ons + basePricePNS, priceDecimals);
}

/** Convert human price to PNS */
export function priceToPNS(price: number, priceDecimals: bigint = PRICE_DECIMALS): bigint {
  return BigInt(Math.round(price * Number(10n ** priceDecimals)));
}

/** Convert human lot to LNS */
export function lotToLNS(lot: number, lotDecimals: bigint = LOT_DECIMALS): bigint {
  return BigInt(Math.round(lot * Number(10n ** lotDecimals)));
}
