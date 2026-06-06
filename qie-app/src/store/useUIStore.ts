import { create } from 'zustand';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface UIState {
  isWalletModalOpen: boolean;
  toasts: Toast[];
  isPreloaderShown: boolean;
  setWalletModalOpen: (open: boolean) => void;
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  removeToast: (id: string) => void;
  setPreloaderShown: (shown: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isWalletModalOpen: false,
  toasts: [],
  isPreloaderShown: false,
  setWalletModalOpen: (open) => set({ isWalletModalOpen: open }),
  addToast: (type, message) => set((state) => ({
    toasts: [...state.toasts, { id: crypto.randomUUID(), type, message }]
  })),
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  })),
  setPreloaderShown: (shown) => set({ isPreloaderShown: shown }),
}));
