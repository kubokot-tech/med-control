'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from './labUtils';

/** Renders children only when a token is present; otherwise sends the user to /login. */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (getToken()) setOk(true);
    else router.replace('/login');
  }, [router]);

  if (!ok) return null;
  return <>{children}</>;
}
