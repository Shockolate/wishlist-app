import Link from 'next/link';
import { Collage } from '@/components/collage';
import { SiteHeader } from '@/components/site-header';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <>
      <SiteHeader action="none" />
      <main className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-7">
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
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={buttonVariants()}>
                Create your list
              </Link>
              <Link href="/login" className={buttonVariants({ variant: 'secondary' })}>
                Log in
              </Link>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
