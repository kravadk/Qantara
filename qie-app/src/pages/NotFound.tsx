import { Link } from 'react-router-dom';

/** Explicit 404 page (replaces the silent redirect-to-home catch-all). */
export function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base px-6 text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary">404</p>
      <h1 className="text-3xl font-bold text-white">Page not found</h1>
      <p className="max-w-md text-sm text-text-muted">
        The page you’re looking for doesn’t exist or has moved.
      </p>
      <Link
        to="/"
        className="rounded-xl bg-primary px-5 py-2.5 font-medium text-black transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        Back to home
      </Link>
    </main>
  );
}
