import { EmailTokenSchema } from '@wishlist/contracts';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { VerifyEmail } from '@/components/auth/verify-email';
import { cspNonce } from '@/lib/nonce';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  const valid =
    typeof token === 'string' && EmailTokenSchema.safeParse(token).success ? token : null;
  return (
    <AuthPage action="login">
      <div className="mx-auto mt-16 max-w-[520px]">
        <VerifyEmail token={valid} hadToken={token !== undefined} nonce={await cspNonce()} />
      </div>
    </AuthPage>
  );
}
