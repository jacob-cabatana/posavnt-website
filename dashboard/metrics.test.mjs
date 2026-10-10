import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics, isReportableSale } from './metrics.mjs';

const at = '2026-10-06T19:12:00Z';
const orders = [
  { createdAt: at, paidAt: at, paymentStatus: 'paid', items: [{ name: 'Cocktail', quantity: 1, lineTotalCents: 1900 }], customerTotalCents: 2711, tipCents: 500, venueTaxCents: 143, backstageTaxCents: 12, backstageFeeCents: 156 },
  { createdAt: at, paidAt: at, paymentStatus: 'paid', items: [{ name: 'Beer', quantity: 1, lineTotalCents: 300 }], customerTotalCents: 498, tipCents: 54, venueTaxCents: 23, backstageTaxCents: 8, backstageFeeCents: 113 },
  { createdAt: at, paidAt: at, paymentStatus: 'paid', items: [{ name: 'Shot', quantity: 1, lineTotalCents: 500 }], customerTotalCents: 756, tipCents: 90, venueTaxCents: 38, backstageTaxCents: 9, backstageFeeCents: 119 },
  { createdAt: at, paidAt: at, paymentStatus: 'paid', items: [{ name: 'Cocktail', quantity: 1, lineTotalCents: 1400 }], customerTotalCents: 1911, tipCents: 252, venueTaxCents: 105, backstageTaxCents: 11, backstageFeeCents: 143 },
  { createdAt: at, paidAt: at, paymentStatus: 'paid', items: [{ name: 'Cocktail', quantity: 1, lineTotalCents: 1000 }], customerTotalCents: 1397, tipCents: 180, venueTaxCents: 75, backstageTaxCents: 10, backstageFeeCents: 132 },
  { createdAt: at, paymentStatus: 'canceled', customerTotalCents: 555, backstageFeeCents: 116 },
];

test('AVNT test charges reconcile with POS totals and exclude canceled attempts', () => {
  const result = calculateMetrics(orders, '7', { now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(result.orders, 5);
  assert.equal(result.salesCents, 5100);
  assert.equal(result.tipsCents, 1076);
  assert.equal(result.venueTaxCents, 384);
  assert.equal(result.feeTaxCents, 50);
  assert.equal(result.customerFeeCents, 663);
  assert.equal(result.chargedCents, 7273);
});

test('venue-paid fees are not added to customer collections', () => {
  const order = { ...orders[0], venuePaysPOSFees: true, customerTotalCents: 2543 };
  const result = calculateMetrics([order], '7', { now: new Date('2026-10-10T12:00:00Z') });
  assert.equal(result.customerFeeCents, 0);
  assert.equal(result.feeTaxCents, 0);
});

test('canceled attempts are not sales', () => assert.equal(isReportableSale(orders.at(-1)), false));
