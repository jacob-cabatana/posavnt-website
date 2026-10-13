import assert from 'node:assert/strict';
import test from 'node:test';
import { payoutAlert } from './payout-status.mjs';

test('live ready venues have no payout warning', () => {
  assert.equal(payoutAlert({ ready: true, testMode: false, connected: true }), null);
});

test('a new live venue is told to set up payouts', () => {
  const alert = payoutAlert({ ready: false, testMode: false, connected: false });
  assert.match(alert.title, /Set up payouts/);
  assert.match(alert.detail, /cannot accept live card payments/);
});

test('an incomplete connected venue is told to finish setup', () => {
  assert.match(payoutAlert({ ready: false, testMode: false, connected: true }).title, /Finish/);
});

test('test mode is never shown as live-ready', () => {
  assert.match(payoutAlert({ ready: true, testMode: true, connected: true }).detail, /cannot accept real payments/);
  assert.match(payoutAlert({ ready: false, testMode: true, connected: false }).title, /test setup/);
});
