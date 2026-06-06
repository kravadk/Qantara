import { useState, useEffect, useCallback } from 'react';
import { cryptoRandom } from '../lib/random';

const CHARS = 'x9$#kL2@mP0!zQ8*vR1&wS7%yT3^uU4(iI5)oO6-pP+aA=sS[dD]fF{gG}hH;jJ:kK"lL<zZ>xX?cC/vV.bB,nN';

export function useCipherScramble(text: string, duration = 600, delay = 0) {
  const [scrambled, setScrambled] = useState('');
  const [isScrambling, setIsScrambling] = useState(false);

  const startScramble = useCallback(() => {
    setIsScrambling(true);
    let iteration = 0;
    const interval = setInterval(() => {
      setScrambled(
        text
          .split('')
          .map((char, index) => {
            if (index < iteration) return text[index];
            return CHARS[Math.floor(cryptoRandom() * CHARS.length)];
          })
          .join('')
      );

      if (iteration >= text.length) {
        clearInterval(interval);
        setIsScrambling(false);
      }

      iteration += text.length / (duration / 30);
    }, 30);

    return () => clearInterval(interval);
  }, [text, duration]);

  useEffect(() => {
    const timeout = setTimeout(startScramble, delay);
    return () => clearTimeout(timeout);
  }, [startScramble, delay]);

  return { scrambled, isScrambling, startScramble };
}
