import { useMemo } from 'react';
import { QANTARA_ADDRESS } from '../lib/dealRoom';

export function useContractStatus() {
  const isDeployed = useMemo(() => Boolean(QANTARA_ADDRESS), []);

  const warnIfNotDeployed = (functionName: string) => {
    if (!isDeployed) {
      console.warn(`[Qantara] Contract function ${functionName} requires VITE_QANTARA_ADDRESS`);
    }
    return isDeployed;
  };

  return { isDeployed, warnIfNotDeployed };
}
