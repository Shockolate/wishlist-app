import Link from 'next/link';
import { Notice } from '@/components/ui/notice';

/**
 * What an unconfirmed email sees in place of a page the API would refuse. We can't know the email
 * was delivered, so this doesn't claim it was (D38).
 */
export function ConfirmEmailNotice({ email, to }: { email: string; to: string }) {
  return (
    <Notice tone="info" className="mt-6">
      Confirm your email {to}. If there’s no email from Hanker at <strong>{email}</strong>,{' '}
      <Link href="/verify-email" className="underline">
        send a new link
      </Link>
      .
    </Notice>
  );
}
