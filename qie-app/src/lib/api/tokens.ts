/** Pure label / token helpers shared across the Qantara API domain modules. */

export function typeLabel(type: number): string {
  return ['Standard', 'Split Bill', 'Recurring', 'Vesting', 'Donation'][type] || 'Unknown';
}

export function statusLabel(status: number): string {
  return ['Created', 'Paid', 'Cancelled', 'Refunded', 'Paused'][status] || 'Unknown';
}

export function tokenSymbol(token: string): 'QIE' | 'QUSDC' {
  return token.toLowerCase() === '0x0000000000000000000000000000000000000000' ? 'QIE' : 'QUSDC';
}
