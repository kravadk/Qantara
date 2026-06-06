import { useCipherScramble } from '../hooks/useCipherScramble';

export function CipherScramble({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const { scrambled } = useCipherScramble(text, 600, delay);
  return <span className={className}>{scrambled}</span>;
}
