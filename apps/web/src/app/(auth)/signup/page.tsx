import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { SignupForm } from '@/components/auth/signup-form';
import { Collage } from '@/components/collage';
import { cspNonce } from '@/lib/nonce';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignupPage() {
  const nonce = await cspNonce();
  return (
    <AuthPage action="login">
      <div className="mt-14 flex flex-wrap items-start gap-x-16 gap-y-12">
        <Collage />
        <div className="min-w-0 max-w-[460px] flex-[1_1_340px]">
          <h1 className="font-display text-[clamp(2.75rem,6vw,4rem)] leading-[0.98] tracking-[-0.01em]">
            One list. One link. No doubled-up gifts.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Add the things you’d love, then share your link with family and friends. They claim
            gifts quietly, so nobody buys the same thing twice, and you never see who’s getting
            what.
          </p>
          <SignupForm nonce={nonce} />
        </div>
      </div>
    </AuthPage>
  );
}
