import { useState, useEffect } from 'react';

let cachedPrice: number | null = null;
let lastFetch = 0;
const CACHE_TTL = 60_000; // 1 minute

export function useEthPrice() {
  const [price, setPrice] = useState<number | null>(cachedPrice);
  const [loading, setLoading] = useState(!cachedPrice);

  useEffect(() => {
    if (cachedPrice && Date.now() - lastFetch < CACHE_TTL) {
      setPrice(cachedPrice);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPrice() {
      // Try multiple sources for ETH price
      const sources = [
        { url: 'https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD', parse: (d: any) => d?.USD },
        { url: 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', parse: (d: any) => d?.ethereum?.usd },
      ];

      for (const src of sources) {
        try {
          const res = await fetch(src.url);
          if (!res.ok) continue;
          const data = await res.json();
          const p = src.parse(data);
          if (p && !cancelled) {
            cachedPrice = p;
            lastFetch = Date.now();
            setPrice(p);
            break;
          }
        } catch { /* try next source */ }
      }

      if (!cancelled) setLoading(false);
    }

    fetchPrice();
    const interval = setInterval(fetchPrice, CACHE_TTL);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const ethToUsd = (eth: number) => price ? eth * price : null;
  const usdToEth = (usd: number) => price ? usd / price : null;

  return { price, loading, ethToUsd, usdToEth };
}
