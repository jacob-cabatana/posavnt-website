import assert from 'node:assert/strict';
import test from 'node:test';
import { coffeeSizePrices, isEspresso, usesCoffeeSizes, validCoffeeSizePrices } from './coffee-sizes.mjs';

test('coffee and espresso offer their choices with safe legacy defaults', () => {
  assert.equal(usesCoffeeSizes({ name: 'Iced Latte', category: 'iced_coffee' }), true);
  assert.equal(usesCoffeeSizes({ name: 'Espresso', category: 'hot_coffee' }), true);
  assert.equal(isEspresso({ name: 'Espresso', category: 'hot_coffee' }), true);
  assert.equal(isEspresso({ name: 'Espresso Martini', category: 'cocktails' }), false);
  assert.deepEqual(coffeeSizePrices({ price: 5 }), { small: 5, medium: 6, large: 7 });
  assert.deepEqual(coffeeSizePrices({ price: 5, sizePrices: { small: 5, medium: 6.5, large: 8 } }),
    { small: 5, medium: 6.5, large: 8 });
});

test('size prices must be positive, ascending, and in cents', () => {
  assert.equal(validCoffeeSizePrices({ small: 5, medium: 6, large: 7 }), true);
  assert.equal(validCoffeeSizePrices({ small: 7, medium: 6, large: 8 }), false);
  assert.equal(validCoffeeSizePrices({ small: 5.001, medium: 6, large: 7 }), false);
});
