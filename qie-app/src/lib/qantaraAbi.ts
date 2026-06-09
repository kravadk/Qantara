import { parseAbi } from 'viem';

/**
 * Minimal ABI for Qantara.sol — only functions the frontend invokes directly.
 * Full ABI is in contracts/artifacts after `npm run build` in contracts/.
 *
 * Note: viem's parseAbi (human-readable format) requires struct definitions to be
 * declared separately with `struct Name { ... }` syntax — inline `tuple(...)` is
 * not supported. See https://abitype.dev/api/human#parseabi
 */

/** Minimal ERC-20 approve ABI — used before calling payInvoiceERC20. */
export const erc20ApproveAbi = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const qantaraAbi = parseAbi([
  'struct Invoice { address merchant; address token; uint256 amount; uint64 createdAt; uint64 expiresAt; bytes32 metadataHash; address payer; uint256 paidAmount; uint64 paidAt; uint8 invoiceType; uint8 status; }',
  'function createInvoice(bytes32 salt, address token, uint256 amount, uint64 expiresAt, bytes32 metadataHash, uint8 invoiceType) external returns (bytes32)',
  'function computeInvoiceHash(address merchant, bytes32 salt) view returns (bytes32)',
  'function payInvoiceNative(bytes32 invoiceHash) external payable',
  'function payInvoiceERC20(bytes32 invoiceHash, uint256 amountIn) external',
  'function payInvoiceERC20WithPermit(bytes32 invoiceHash, uint256 amountIn, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
  'function payInvoiceERC20WithAuthorization(bytes32 invoiceHash, uint256 amountIn, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
  'function cancelInvoice(bytes32 invoiceHash) external',
  'function refundInvoice(bytes32 invoiceHash) external payable',
  'function pauseInvoice(bytes32 invoiceHash) external',
  'function resumeInvoice(bytes32 invoiceHash) external',
  'function withdrawRefund(address token) external',
  'function getInvoice(bytes32 invoiceHash) view returns (Invoice)',
  'event InvoiceCreated(bytes32 indexed invoiceHash, address indexed merchant, address indexed token, uint256 amount, uint8 invoiceType, uint64 expiresAt, bytes32 metadataHash)',
  'event InvoicePaid(bytes32 indexed invoiceHash, address indexed payer, uint256 amount)',
]);

/** Minimal ABI for MilestoneEscrow.sol — pre-funded 4-tier escrow. */
export const milestoneEscrowAbi = parseAbi([
  'struct Escrow { address payer; address merchant; address token; address arbiter; uint256 totalAmount; uint256 claimedAmount; uint8 nextTier; uint64 createdAt; uint8 status; }',
  'function createEscrow(address merchant, address token, address arbiter, uint256 totalAmount, bytes32 salt) external payable returns (bytes32)',
  'function computeEscrowId(address payer, address merchant, bytes32 salt) view returns (bytes32)',
  'function claimMilestone(bytes32 escrowId) external',
  'function refundRemainder(bytes32 escrowId) external',
  'function getEscrow(bytes32 escrowId) view returns (Escrow)',
  'function previewNextMilestone(bytes32 escrowId) view returns (uint8 tier, uint256 amount)',
  'event EscrowCreated(bytes32 indexed escrowId, address indexed payer, address indexed merchant, address token, address arbiter, uint256 totalAmount)',
  'event MilestoneClaimed(bytes32 indexed escrowId, uint8 tier, uint256 amount, uint256 cumulativeClaimed)',
  'event EscrowCompleted(bytes32 indexed escrowId, uint256 totalClaimed)',
  'event EscrowRefunded(bytes32 indexed escrowId, address indexed by, uint256 amount)',
]);

/** InstallmentPlan.sol — pay-over-time (BNPL) plans. */
export const installmentPlanAbi = parseAbi([
  'struct Plan { address payer; address merchant; address token; uint256 amountPerInstallment; uint64 interval; uint32 totalInstallments; uint32 paidInstallments; uint32 claimedInstallments; uint64 createdAt; uint8 status; }',
  'function createPlan(address merchant, address token, uint256 amountPerInstallment, uint64 interval, uint32 totalInstallments, bytes32 salt) external returns (bytes32)',
  'function computePlanId(address payer, address merchant, bytes32 salt) view returns (bytes32)',
  'function payInstallments(bytes32 planId, uint32 count) external payable',
  'function claimInstallments(bytes32 planId) external',
  'function cancelPlan(bytes32 planId) external',
  'function getPlan(bytes32 planId) view returns (Plan)',
  'function dueAt(bytes32 planId, uint32 n) view returns (uint64)',
  'event PlanCreated(bytes32 indexed planId, address indexed payer, address indexed merchant, address token, uint256 amountPerInstallment, uint64 interval, uint32 totalInstallments)',
  'event InstallmentsPaid(bytes32 indexed planId, uint32 paidInstallments, uint256 amount)',
  'event InstallmentsClaimed(bytes32 indexed planId, uint32 claimedInstallments, uint256 amount)',
  'event PlanCompleted(bytes32 indexed planId)',
  'event PlanCancelled(bytes32 indexed planId, uint256 refundedToPayer)',
]);

/** BuyerEscrow.sol — single-release escrow with buyer-controlled release (buyer protection). */
export const buyerEscrowAbi = parseAbi([
  'struct Deal { address payer; address merchant; address token; address arbiter; uint256 amount; uint64 fundedAt; uint64 autoReleaseAt; uint8 status; }',
  'function createEscrow(address merchant, address token, address arbiter, uint256 amount, uint64 autoReleaseSeconds, bytes32 salt) external payable returns (bytes32)',
  'function computeDealId(address payer, address merchant, bytes32 salt) view returns (bytes32)',
  'function confirmRelease(bytes32 dealId) external',
  'function claimAfterTimeout(bytes32 dealId) external',
  'function refund(bytes32 dealId) external',
  'function getDeal(bytes32 dealId) view returns (Deal)',
  'event DealFunded(bytes32 indexed dealId, address indexed payer, address indexed merchant, address token, address arbiter, uint256 amount, uint64 autoReleaseAt)',
  'event DealReleased(bytes32 indexed dealId, address indexed by, uint256 amount)',
  'event DealRefunded(bytes32 indexed dealId, address indexed by, uint256 amount)',
]);

/** Minimal ABI for RecurringScheduler.sol — prefunded subscription. */
export const recurringSchedulerAbi = parseAbi([
  'struct Sub { address payer; address merchant; address token; uint256 amountPerPeriod; uint64 interval; uint32 totalPeriods; uint32 claimedPeriods; uint64 startedAt; uint8 status; }',
  'function createSubscription(address merchant, address token, uint256 amountPerPeriod, uint64 interval, uint32 totalPeriods, bytes32 salt) external payable returns (bytes32)',
  'function computeSubId(address payer, address merchant, bytes32 salt) view returns (bytes32)',
  'function accruedPeriods(bytes32 subId) view returns (uint32)',
  'function claim(bytes32 subId) external',
  'function cancel(bytes32 subId) external',
  'function getSubscription(bytes32 subId) view returns (Sub)',
  'event SubscriptionCreated(bytes32 indexed subId, address indexed payer, address indexed merchant, address token, uint256 amountPerPeriod, uint64 interval, uint32 totalPeriods)',
  'event PeriodsClaimed(bytes32 indexed subId, uint32 periodsClaimed, uint256 amount, uint32 cumulativeClaimed)',
  'event SubscriptionCompleted(bytes32 indexed subId)',
  'event SubscriptionCancelled(bytes32 indexed subId, uint256 refundedToPayer, uint256 claimedByMerchant)',
]);

/** Minimal ABI for BatchPayout.sol — pull-claim payouts. */
export const batchPayoutAbi = parseAbi([
  'struct Batch { address funder; address token; uint256 totalAmount; uint256 claimedAmount; uint64 createdAt; uint64 expiresAt; bool reclaimed; }',
  'function createBatch(address token, address[] recipients, uint256[] amounts, uint64 expiresAt, bytes32 salt) external payable returns (bytes32)',
  'function computeBatchId(address funder, bytes32 salt) view returns (bytes32)',
  'function claim(bytes32 batchId) external',
  'function reclaim(bytes32 batchId) external',
  'function getBatch(bytes32 batchId) view returns (Batch)',
  'function entitlementOf(bytes32 batchId, address recipient) view returns (uint256)',
  'event BatchCreated(bytes32 indexed batchId, address indexed funder, address indexed token, uint256 totalAmount, uint256 recipientCount, uint64 expiresAt)',
  'event BatchClaim(bytes32 indexed batchId, address indexed recipient, uint256 amount)',
  'event BatchReclaimed(bytes32 indexed batchId, address indexed funder, uint256 amount)',
]);

/** Minimal ABI for QantaraMultiPay.sol — collective invoices. */
export const qantaraMultiPayAbi = parseAbi([
  'struct MultiPayInvoice { address merchant; address token; uint256 goal; uint256 totalRaised; uint64 createdAt; uint64 expiresAt; bytes32 metadataHash; uint8 status; }',
  'function createInvoice(bytes32 salt, address token, uint256 goal, uint64 expiresAt, bytes32 metadataHash) external returns (bytes32)',
  'function computeInvoiceHash(address merchant, bytes32 salt) view returns (bytes32)',
  'function contributeNative(bytes32 invoiceHash) external payable',
  'function contributeERC20(bytes32 invoiceHash, uint256 amountIn) external',
  'function settleInvoice(bytes32 invoiceHash) external',
  'function cancelInvoice(bytes32 invoiceHash) external',
  'function claimRefund(bytes32 invoiceHash) external',
  'function withdrawRefund(address token) external',
  'function getInvoice(bytes32 invoiceHash) view returns (MultiPayInvoice)',
  'function getContribution(bytes32 invoiceHash, address payer) view returns (uint256)',
  'event MultiPayCreated(bytes32 indexed invoiceHash, address indexed merchant, address indexed token, uint256 goal, uint64 expiresAt, bytes32 metadataHash)',
  'event MultiPayContribution(bytes32 indexed invoiceHash, address indexed payer, uint256 amount, uint256 newTotal)',
  'event MultiPaySettled(bytes32 indexed invoiceHash, uint256 totalRaised)',
  'event MultiPayCancelled(bytes32 indexed invoiceHash)',
]);
