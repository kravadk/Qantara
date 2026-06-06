import { motion } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  return (
    <motion.button
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.9, rotate: 360 }}
      onClick={toggleTheme}
      className={`fixed bottom-8 right-8 z-[10005] w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-colors duration-400 ${
        theme === 'dark' ? 'bg-[#1B1B1B] text-[#F02C78]' : 'bg-white text-[#EF6B78]'
      }`}
    >
      {theme === 'dark' ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
    </motion.button>
  );
}
