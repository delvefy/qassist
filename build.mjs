import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const commonOptions = {
  bundle: true,
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

const entryPoints = [
  { in: 'src/background/service-worker.ts', out: 'background/service-worker' },
  { in: 'src/content/content-script.ts', out: 'content/content-script' },
  { in: 'src/content/error-capture.ts', out: 'content/error-capture' },
  { in: 'src/popup/popup.ts', out: 'popup/popup' },
  { in: 'src/options/options.ts', out: 'options/options' },
];

const buildOptions = {
  ...commonOptions,
  entryPoints: entryPoints.map(e => ({ in: e.in, out: e.out })),
  outdir: 'dist',
  format: 'esm',
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
}
