'use client';

import { usePathname } from 'next/navigation';
import MainNav from './MainNav';
import AuthGate from './AuthGate';
import ChatWidget from './ChatWidget';
import { FormatProvider } from './format';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/offline' || pathname === '/setup' || pathname === '/welcome') return <>{children}</>;

  return (
    <div className="app-shell">
      <MainNav />
      <main className="main-content">
        <AuthGate><FormatProvider>{children}<ChatWidget /></FormatProvider></AuthGate>
      </main>
    </div>
  );
}
