import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { EmailLinkForm } from '@/components/auth/email-link-form';
import { Card } from '@/components/ui/card';
import { cspNonce } from '@/lib/nonce';

export const metadata: Metadata = { title: 'Reset your password' };

export default async function ResetPasswordPage() {
  return (
    <AuthPage action="login">
      <div className="mx-auto mt-16 max-w-[520px]">
        <Card>
          <h1 className="font-display text-5xl leading-none">Reset your password</h1>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Enter your email and we’ll send a link to choose a new password. It works once, within
            an hour.
          </p>
          <EmailLinkForm
            endpoint="/auth/password-reset/request"
            submitLabel="Send the link"
            sentMessage="If an account uses that address, a link is on its way. It works once, within an hour."
            nonce={await cspNonce()}
          />
        </Card>
      </div>
    </AuthPage>
  );
}
