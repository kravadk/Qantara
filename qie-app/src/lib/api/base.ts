/** Foundational invoice enums + the backend invoice shape, shared across API modules. */
import type { BackendInvoice } from '../dealRoom';

export const InvoiceStatus = {
  Created: 0,
  Paid: 1,
  Cancelled: 2,
  Refunded: 3,
  Paused: 4,
} as const;

export const InvoiceType = {
  Standard: 0,
  MultiPay: 1,
  Recurring: 2,
  Vesting: 3,
  Donation: 4,
} as const;

export type InvoiceStatusValue = typeof InvoiceStatus[keyof typeof InvoiceStatus];
export type InvoiceTypeValue = typeof InvoiceType[keyof typeof InvoiceType];
export type QantaraInvoice = BackendInvoice;
