// Vercel deploys a source map beside each compiled file: report TypeScript lines (D52).
// Node parses a module's source map only if the flag is already on when the module loads,
// and ESM links every static import before the importing module runs. So the flag is set
// here, and the app's modules load afterwards, through a dynamic import.
process.setSourceMapsEnabled(true);
await import('./bootstrap.js');
