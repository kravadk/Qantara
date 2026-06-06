import { Navbar } from '../components/Navbar';
import { Outlet } from 'react-router-dom';
import { Preloader } from '../components/Preloader';

export function LandingLayout() {
  return (
    <div className="relative min-h-screen bg-bg-base overflow-x-hidden">
      <Preloader />
      <div className="noise-overlay pointer-events-none" />
      <Navbar />
      <main className="pt-20">
        <Outlet />
      </main>
    </div>
  );
}
