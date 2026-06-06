import { motion } from 'framer-motion';
import { Navbar } from '../components/Navbar';
import { Outlet } from 'react-router-dom';
import { Preloader } from '../components/Preloader';
import { CustomCursor } from '../components/CustomCursor';
export function LandingLayout() {
  return (
    <div className="relative min-h-screen bg-bg-base overflow-x-hidden">
      <Preloader />
      <CustomCursor />
      <div className="noise-overlay pointer-events-none" />
      <Navbar />
      <motion.main
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="pt-20"
      >
        <Outlet />
      </motion.main>
    </div>
  );
}
