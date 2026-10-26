# Fonts for the share preview image

`next/og` draws a share link's preview (`src/lib/share-preview-image.tsx`) with these fonts. It
needs static TTF or OTF files, not the variable fonts the site loads through `next/font`, so they're
committed here and read from disk at render time. `next.config.ts` traces them into the preview
route's function (`outputFileTracingIncludes`).

| File                          | Source                                                                                                                                       | SHA-256                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `InstrumentSerif-Regular.ttf` | https://raw.githubusercontent.com/google/fonts/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/instrumentserif/InstrumentSerif-Regular.ttf      | `498efd461f6ddfcb7a111bf9a565709d2085d48201d501ead960d93e84ffbb88` |
| `Geist-Regular.ttf`           | https://raw.githubusercontent.com/vercel/geist-font/b5d164a0c066c2c9bfcd5ab65dd8244551f0ac06/fonts/Geist/ttf/Geist-Regular.ttf (Geist 1.800) | `85a1c6b18a6b0a06dfe9fd4f6d6a5d4979f74ec861eaef4bc7868b5492b8a117` |

Both are static instances (`fc-query` reports `variable: False`).

Both are licensed under the SIL Open Font License 1.1, in [OFL.txt](OFL.txt), which carries each
project's copyright line from its upstream licence file:

- https://raw.githubusercontent.com/google/fonts/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/instrumentserif/OFL.txt
- https://raw.githubusercontent.com/vercel/geist-font/b5d164a0c066c2c9bfcd5ab65dd8244551f0ac06/OFL.txt
