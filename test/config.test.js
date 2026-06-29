import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, publicConfig } from '../src/config.js';

test('parses separate admin listener config', () => {
  const config = loadConfig({
    ADMIN_ENABLED: 'false',
    ADMIN_BIND_HOST: '127.0.0.1',
    ADMIN_PORT: '19000',
    ADMIN_TOKEN: 'legacy-token'
  });

  assert.equal(config.adminEnabled, false);
  assert.equal(config.adminBindHost, '127.0.0.1');
  assert.equal(config.adminPort, 19000);

  const safe = publicConfig(config);
  assert.equal(safe.adminEnabled, false);
  assert.equal(safe.adminBindHost, '127.0.0.1');
  assert.equal(safe.adminPort, 19000);
  assert.equal(safe.adminPortalAuthRequired, false);
  assert.equal(safe.legacyAdminApiAuthEnabled, true);
});

test('defaults admin portal to enabled on port 11435 without changing API port', () => {
  const config = loadConfig({ ADMIN_TOKEN: '' });
  assert.equal(config.port, 11434);
  assert.equal(config.adminEnabled, true);
  assert.equal(config.adminBindHost, '0.0.0.0');
  assert.equal(config.adminPort, 11435);
});
