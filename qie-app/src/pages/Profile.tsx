import { motion } from 'framer-motion';
import { Shield, Copy, ExternalLink, ArrowRight } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { useToastStore } from '../components/ToastContainer';
import { qieMainnet } from '../config/wagmi';
import { QRCodeSVG } from 'qrcode.react';

export function Profile() {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const { addToast } = useToastStore();

  const isValidAddress = address?.startsWith('0x') && address.length === 42;

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <div className="px-8 py-6 flex items-center justify-between">
        <a href="/app/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="Qantara" className="w-6 h-6 rounded-md" />
          <span className="text-sm font-bold text-white tracking-tight">Qantara</span>
        </a>
        <a href="/app/dashboard" className="text-xs text-text-muted hover:text-primary transition-colors">
          &lt; Go to Dashboard
        </a>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[420px] space-y-8">

          {!isValidAddress ? (
            <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 text-center space-y-4">
              <Shield className="w-12 h-12 text-text-dim mx-auto" />
              <h2 className="text-xl font-bold text-white">Invalid Address</h2>
              <p className="text-sm text-text-muted">This profile link is not valid.</p>
            </div>
          ) : (
            <>
              {/* Profile Card */}
              <div className="bg-surface-1 border border-border-default rounded-[32px] p-8 space-y-6 text-center">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-2xl font-bold text-primary mx-auto">
                  {address.slice(2, 4).toUpperCase()}
                </div>

                <div className="space-y-2">
                  <h1 className="text-2xl font-bold text-white">Qantara Profile</h1>
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-sm font-mono text-text-secondary">{address.slice(0, 10)}...{address.slice(-8)}</p>
                    <button onClick={() => { navigator.clipboard.writeText(address); addToast('success', 'Address copied'); }}
                      className="text-text-muted hover:text-primary"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                <div className="flex justify-center">
                  <div className="p-4 bg-white rounded-2xl">
                    <QRCodeSVG value={`${window.location.origin}/profile/${address}`} size={160} bgColor="#ffffff" fgColor="#0a0a0a" level="H" />
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-text-muted">Scan to view this profile</p>
                  <a href={`${qieMainnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center justify-center gap-1">
                    View in explorer <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* Action — Create invoice for this address */}
              <div className="bg-surface-1 border border-primary/20 rounded-[24px] p-6 space-y-4">
                <h3 className="text-sm font-bold text-white">Create an invoice</h3>
                <p className="text-xs text-text-muted">
                  Create an on-chain invoice addressed to this wallet and track settlement through QIE RPC.
                </p>
                <Button className="w-full gap-2" onClick={() => navigate(`/app/new-cipher?recipient=${address}`)}>
                  Create Invoice for {address.slice(0, 6)}...{address.slice(-4)} <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </div>

      <div className="px-8 py-6 text-center">
        <p className="text-xs text-text-muted uppercase tracking-widest">Qantara — Non-custodial payments on QIE Mainnet</p>
      </div>
    </div>
  );
}
