import { create } from 'zustand';

// Invoice type — used across components for type safety
// All invoice DATA comes from blockchain via useInvoices() hook
export interface Invoice {
  id: string;
  hash: string;
  type: 'standard' | 'multi-pay' | 'recurring' | 'vesting' | 'batch';
  status: 'open' | 'settled' | 'cancelled' | 'locked' | 'paused';
  createdAt: string;
  amount: string;
  token?: 'QIE' | 'QUSDC';
  seller: string;
  recipient: string;
  memo: string;
  blockNumber: number;
  nextPaymentDate?: string;
  cyclesLeft?: number;
  unlockDate?: string;
  creator?: string;
  timestamp?: number;
  deadline?: number;
  unlockHeight?: number;
  recipientCount?: number;
  encryptedAmountCt?: bigint;
  revealedAmount?: string;
  isAmountRevealed?: boolean;
  totalCollected?: string;
  targetAmount?: string;
  payerCount?: number;
  collectedPercent?: number;
}

// UI-only state — no invoice data stored here
// All invoice data comes from blockchain via useInvoices() hook
interface UIState {
  revealAmounts: boolean;
  toggleReveal: () => void;
}

export const useInvoiceStore = create<UIState>((set) => ({
  revealAmounts: false,
  toggleReveal: () => set((state) => ({ revealAmounts: !state.revealAmounts })),
}));

interface AppPreferencesState {
  compactMode: boolean;
  defaultToken: 'QIE' | 'QUSDC';
  dismissedOnboarding: boolean;
  setCompactMode: (value: boolean) => void;
  setDefaultToken: (value: 'QIE' | 'QUSDC') => void;
  setDismissedOnboarding: (value: boolean) => void;
}

export const useAppPreferencesStore = create<AppPreferencesState>((set) => ({
  compactMode: false,
  defaultToken: 'QIE',
  dismissedOnboarding: false,
  setCompactMode: (value) => set({ compactMode: value }),
  setDefaultToken: (value) => set({ defaultToken: value }),
  setDismissedOnboarding: (value) => set({ dismissedOnboarding: value }),
}));
