'use client';

import { usePathname } from 'next/navigation';
import MainNav from './MainNav';
import AuthGate from './AuthGate';
import ChatWidget from './ChatWidget';
import FaceLock from './FaceLock';
import { FormatProvider } from './format';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/offline' || pathname === '/setup') return <>{children}</>;
  // Welcome keeps its own layout, but it shows the person's data: the lock applies to it too.
  if (pathname === '/welcome') return <FaceLock>{children}</FaceLock>;

  return (
    <FaceLock>
      <div className="app-shell">
        <MainNav />
        <main className="main-content">
          <AuthGate><FormatProvider>{children}<ChatWidget /></FormatProvider></AuthGate>
        </main>
      </div>
    </FaceLock>
  );
}
