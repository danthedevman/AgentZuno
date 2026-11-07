import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { enableLocalInstallation } from '../src/storage/configuration.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { recoverLocalAccount } from '../src/identity/localRecovery.js';

if (!stdin.isTTY || !stdout.isTTY || process.argv.length !== 2) {
  console.error(
    'Run interactively on the API server without arguments. Passwords cannot be supplied through command-line flags.',
  );
  process.exitCode = 1;
} else {
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!hidden) stdout.write(chunk, encoding);
      done();
    },
  });
  const prompt = createInterface({ input: stdin, output, terminal: true });
  let store;
  try {
    const email = await prompt.question('Local account email: ');
    const confirmation = await prompt.question(
      'Reset this account password and revoke all its sessions? Type RESET: ',
    );
    if (confirmation !== 'RESET') throw new Error('Recovery canceled.');
    stdout.write('New password (12–200 characters, hidden): ');
    hidden = true;
    const password = await prompt.question('');
    stdout.write('\nConfirm password (hidden): ');
    const repeated = await prompt.question('');
    hidden = false;
    stdout.write('\n');
    if (password !== repeated) throw new Error('Passwords do not match.');
    enableLocalInstallation();
    store = createIntegrationStore();
    await recoverLocalAccount(store, email, password);
    console.log('Password reset. Previous sessions revoked. Sign in again.');
  } catch {
    // Database and configuration errors can include connection credentials.
    console.error(
      '\nRecovery did not complete. Check the local account, matching passwords, and API database configuration, then retry.',
    );
    process.exitCode = 1;
  } finally {
    prompt.close();
    await store?.close();
  }
}
