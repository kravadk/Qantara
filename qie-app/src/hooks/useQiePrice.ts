import { useEffect, useState } from 'react';

/**
 * Fetches QIE price in USD from a configured CORS-safe price endpoint.
 * Third-party APIs such as CoinGecko should be proxied by the backend or another
 * owned service before being used in the browser.
 */

let cachedPrice: number | null = null;
let lastFetch = 0;
const CACHE_TTL = 60_000;

const PRICE_URL = import.meta.env.VITE_QIE_PRICE_API_URL || '';

export function useQiePrice() {
  const [price, setPrice] = useState<number | null>(cachedPrice);
  const [loading, setLoading] = useState(!cachedPrice);

  useEffect(() => {
    if (!PRICE_URL) {
      setLoading(false);
      return;
    }

    if (cachedPrice && Date.now() - lastFetch < CACHE_TTL) {
      setPrice(cachedPrice);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchPrice() {
      try {
        const res = await fetch(PRICE_URL);
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = await res.json();
        const p = data?.qie?.usd ?? data?.priceUsd ?? data?.usd;
        if (typeof p === 'number' && p > 0 && !cancelled) {
          cachedPrice = p;
          lastFetch = Date.now();
          setPrice(p);
        }
      } catch {
        // Silent — UI gracefully degrades when offline.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchPrice();
    const interval = setInterval(() => void fetchPrice(), CACHE_TTL);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const qieToUsd = (qie: number) => (price !== null ? qie * price : null);
  const usdToQie = (usd: number) => (price !== null ? usd / price : null);

  return { price, loading, qieToUsd, usdToQie };
}
