import { EmailTokenSchema } from '@wishlist/contracts';
import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth-page';
import { ChooseNewPassword } from '@/components/auth/choose-new-password';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ConfirmResetPage({
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
        <ChooseNewPassword token={valid} />
      </div>
    </AuthPage>
  );
}
