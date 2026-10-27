import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { FreshDocument } from '@/components/auth/fresh-document';
import { LoginForm } from '@/components/auth/login-form';
import { safeNext } from '@/lib/safe-next';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <AuthPage action="signup">
      <FreshDocument />
      <div className="mx-auto mt-16 max-w-[460px]">
        <LoginForm next={safeNext(typeof next === 'string' ? next : null)} />
      </div>
    </AuthPage>
  );
}
