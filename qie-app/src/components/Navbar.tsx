import { motion } from 'framer-motion';
import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from './Button';

export function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 80);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Product', path: '/showcase' },
    { name: 'Manifesto', path: '/manifesto' },
    { name: 'Status', path: '/status' },
  ];

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className={`fixed top-0 left-0 right-0 z-[9999] h-20 flex items-center justify-between px-8 md:px-16 transition-all duration-300 ${
        isScrolled ? 'bg-bg-base/90 backdrop-blur-xl border-b border-border-default' : 'bg-transparent'
      }`}
    >
      <Link to="/" className="flex items-center gap-2 group">
        <img src="/logo.png" alt="Qantara" className="w-8 h-8 rounded-lg group-hover:scale-110 transition-transform duration-300" />
        <span className="text-xl font-bold text-white tracking-tight">Qantara</span>
      </Link>

      <div className="hidden md:flex items-center gap-8">
        {navLinks.map((link) => (
          <Link
            key={link.name}
            to={link.path}
            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
              location.pathname === link.path ? 'text-white' : 'text-text-secondary hover:text-white'
            }`}
          >
            {location.pathname === link.path && (
              <motion.div
                layoutId="nav-pill"
                className="absolute inset-0 bg-surface-2 rounded-full -z-10"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
            {link.name}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <Link to="/app/start">
          <Button size="sm">Connect Wallet</Button>
        </Link>
      </div>
    </motion.nav>
  );
}
