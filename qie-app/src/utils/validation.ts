/**
 * Validate an Ethereum address
 */
export function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/**
 * Validate a QIE amount string (or any 18-decimal native token).
 */
export function isValidAmount(amount: string): { valid: boolean; error?: string } {
  if (!amount || amount.trim() === '') return { valid: false, error: 'Amount is required' };

  const num = parseFloat(amount);
  if (isNaN(num)) return { valid: false, error: 'Invalid number' };
  if (num <= 0) return { valid: false, error: 'Amount must be greater than 0' };
  if (num > 1000000) return { valid: false, error: 'Amount too large' };

  // QIE is 18-decimal (same as native ETH semantics under EVM).
  const parts = amount.split('.');
  if (parts[1] && parts[1].length > 18) return { valid: false, error: 'Too many decimals (max 18)' };

  return { valid: true };
}

/**
 * Validate a bytes32 hash
 */
export function isValidHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

/**
 * Sanitize and validate recipient address
 */
export function validateRecipient(addr: string): { valid: boolean; error?: string; address: string } {
  if (!addr || addr.trim() === '') return { valid: true, address: '', error: undefined }; // optional field
  const trimmed = addr.trim();
  if (!isValidAddress(trimmed)) return { valid: false, error: 'Invalid Ethereum address (0x + 40 hex chars)', address: trimmed };
  return { valid: true, address: trimmed };
}
