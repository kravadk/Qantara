export function PaymentNetworkFallback() {
  return (
    <div className="relative h-[420px] w-full overflow-hidden rounded-[2rem] border border-primary/20 bg-[#090611] md:h-[560px]">
      <div className="absolute inset-0 qie-mesh-bg opacity-80" />
      <div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/35 bg-primary/10 shadow-[0_0_80px_rgba(240,44,120,0.35)]" />
      <div className="absolute inset-x-8 top-1/2 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />
      <div className="absolute inset-x-5 bottom-5 grid grid-cols-3 gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
        <span className="rounded-full border border-border-default bg-bg-base/70 px-3 py-2">Payer</span>
        <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-2 text-primary">Verified rail</span>
        <span className="rounded-full border border-border-default bg-bg-base/70 px-3 py-2 text-right">Receipt</span>
      </div>
    </div>
  );
}
