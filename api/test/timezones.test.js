import test from 'node:test';
import assert from 'node:assert/strict';
import { isTimeZone } from '../src/timezones.js';
import { timeZoneOptions } from '../../src/services/timezones.js';

test('timezones accept browser IANA identifiers and retain saved zones outside common choices', () => {
  for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Amsterdam'])
    assert.ok(isTimeZone(zone));
  for (const zone of ['', undefined, [], {}, 'not-a-timezone', 'UTC'.repeat(100)])
    assert.equal(isTimeZone(zone), false);
  assert.ok(
    timeZoneOptions('Europe/Amsterdam').some((option) => option.value === 'Europe/Amsterdam'),
  );
  assert.equal(timeZoneOptions('UTC').filter((option) => option.value === 'UTC').length, 1);
});
