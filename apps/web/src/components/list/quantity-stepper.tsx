'use client';

import { useRef } from 'react';
import { MinusIcon, PlusIcon } from './icons';

const MIN = 1;
const MAX = 99;
const STEP = 'inline-flex size-11 items-center justify-center rounded-control disabled:opacity-30';

/** "How many": 1–99 (spec §2). The number is an <output>, so a change is announced. */
export function QuantityStepper({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const labelId = `${id}-label`;
  const fewer = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  // A button that disables itself drops focus to <body>; hand it to the other one first.
  const step = (next: number) => {
    onChange(next);
    if (next <= MIN) more.current?.focus();
    if (next >= MAX) fewer.current?.focus();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-[15px] font-semibold">
        How many
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex h-12 items-center rounded-control border-[1.5px] border-input bg-card"
      >
        <button
          type="button"
          ref={fewer}
          aria-label="Fewer"
          disabled={value <= MIN}
          onClick={() => step(value - 1)}
          className={STEP}
        >
          <MinusIcon />
        </button>
        <output id={id} className="min-w-6 text-center text-[17px] font-semibold">
          {value}
        </output>
        <button
          type="button"
          ref={more}
          aria-label="More"
          disabled={value >= MAX}
          onClick={() => step(value + 1)}
          className={STEP}
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
