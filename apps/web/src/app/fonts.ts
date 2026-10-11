import { Geist, Instrument_Serif } from 'next/font/google';

/** Geist for everything people read and use; Instrument Serif for the wordmark and headings. */
export const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});
