import type { ReactNode } from 'react';

/** A decorative 20×20 stroke icon in the text colour; the control around it carries the name. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const CopyIcon = () => (
  <Icon>
    <rect x="7" y="7" width="9" height="9" rx="2" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </Icon>
);
export const ShareIcon = () => (
  <Icon>
    <path d="M10 3v10M6.5 6.5 10 3l3.5 3.5M5 10v5.5A1.5 1.5 0 0 0 6.5 17h7a1.5 1.5 0 0 0 1.5-1.5V10" />
  </Icon>
);
export const GripIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0" fill="currentColor">
    <circle cx="7" cy="5" r="1.5" />
    <circle cx="13" cy="5" r="1.5" />
    <circle cx="7" cy="10" r="1.5" />
    <circle cx="13" cy="10" r="1.5" />
    <circle cx="7" cy="15" r="1.5" />
    <circle cx="13" cy="15" r="1.5" />
  </svg>
);
export const ChevronUpIcon = () => (
  <Icon>
    <path d="M5 12.5 10 7.5l5 5" />
  </Icon>
);
export const ChevronDownIcon = () => (
  <Icon>
    <path d="M5 7.5l5 5 5-5" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M5 5l10 10M15 5 5 15" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
  </Icon>
);
export const PhotoIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <circle cx="8" cy="8.5" r="1.5" />
    <path d="M3 14l4-4 3 3 2-2 5 5" />
  </Icon>
);
export const IdeaIcon = () => (
  <Icon>
    <path d="M10 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9zM8 17h4" />
  </Icon>
);
export const MinusIcon = () => (
  <Icon>
    <path d="M5 10h10" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M10 5v10M5 10h10" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="M5 10.5 8.5 14 15 6.5" />
  </Icon>
);
export const ExternalIcon = () => (
  <Icon>
    <path d="M7 13 15 5M8 5h7v7" />
  </Icon>
);
export const EyeOffIcon = () => (
  <Icon>
    <path d="M3 3l14 14M8.2 5.3A8 8 0 0 1 10 5c4.5 0 7.5 5 7.5 5a14 14 0 0 1-2 2.6M5.6 7A13 13 0 0 0 2.5 10s3 5 7.5 5a7.6 7.6 0 0 0 3.3-.8M8.6 8.6a2 2 0 0 0 2.8 2.8" />
  </Icon>
);
export const TagIcon = () => (
  <Icon>
    <path d="M3.5 4.5v5.1a1 1 0 0 0 .3.7l6.2 6.2a1 1 0 0 0 1.4 0l5.1-5.1a1 1 0 0 0 0-1.4L10.3 3.8a1 1 0 0 0-.7-.3H4.5a1 1 0 0 0-1 1z" />
    <circle cx="7" cy="7" r="1" />
  </Icon>
);
export const ArrowLeftIcon = () => (
  <Icon>
    <path d="M16 10H4M8.5 5.5 4 10l4.5 4.5" />
  </Icon>
);
