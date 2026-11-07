// Runs the real handlers from public/app.js (extracted, with I/O mocked) for the flows a blind user
// depends on: the final check, picking the pointing hand, finishing honestly, stale replies, smoothing.
import test from 'node:test';
import { execFileSync } from 'node:child_process';

for (const name of ['review', 'hands', 'finish', 'stale', 'euro']) {
  test(`app logic: ${name}`, () => {
    execFileSync(process.execPath, [`test/app-logic/${name}-test.cjs`, 'public/app.js'], { stdio: 'pipe' });
  });
}
