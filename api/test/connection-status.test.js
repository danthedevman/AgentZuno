import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionStatus } from '../../src/services/connectionStatus.js';

test('connection badges distinguish live adapters, snapshots and operational failures', () => {
  assert.equal(connectionStatus([]).label, 'Not configured');
  assert.equal(connectionStatus([{ status: 'Connected', authType: 'oauth' }]).label, 'Active');
  assert.equal(
    connectionStatus([{ status: 'Connected', authType: 'export' }]).label,
    'Imported snapshot',
  );
  assert.equal(
    connectionStatus([{ status: 'Connected', sync: { status: 'Syncing' } }]).label,
    'Syncing',
  );
  assert.equal(
    connectionStatus([{ status: 'Connected', sync: { status: 'Failed' } }]).label,
    'Needs attention',
  );
  assert.equal(connectionStatus([{ status: 'Disconnected' }]).label, 'Disconnected');
  assert.equal(connectionStatus([{ status: 'Not connected' }]).label, 'Configured');
});
