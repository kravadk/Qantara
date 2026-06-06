/**
 * Centralized "where to get QIE" registry.
 * Data sourced from CoinGecko tickers + qie.digital ecosystem.
 */

export interface QieExchange {
  name: string;
  url: string;
  pair: string;
  badge?: 'Top liquidity' | 'Verified';
}

export const QIE_EXCHANGES: QieExchange[] = [
  { name: 'MEXC', url: 'https://www.mexc.com/exchange/QIE_USDT', pair: 'QIE/USDT', badge: 'Top liquidity' },
  { name: 'XT.COM', url: 'https://www.xt.com/en/trade/qie_usdt', pair: 'QIE/USDT' },
  { name: 'BitMart', url: 'https://www.bitmart.com/trade/en?symbol=QIE_USDT', pair: 'QIE/USDT' },
];

export const QIE_LINKS = {
  homepage: 'https://www.qie.digital',
  wallet: 'https://www.qiewallet.me',
  mainnet: 'https://mainnet.qie.digital',
  pass: 'https://www.qiepass.qie.digital',
  coingecko: 'https://www.coingecko.com/en/coins/qie',
};
