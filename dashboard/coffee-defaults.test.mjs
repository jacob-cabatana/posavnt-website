import assert from 'node:assert/strict';
import test from 'node:test';
import { coffeeStartersToSync, isUnpricedStarter } from './coffee-defaults.mjs';

test('new coffee venues receive iced and hot starters', () => {
  assert.deepEqual(coffeeStartersToSync([]).map(item => item.slug), [
    'iced-coffee', 'cold-brew', 'iced-americano', 'iced-latte', 'iced-mocha',
    'hot-coffee', 'americano', 'espresso', 'latte', 'cappuccino', 'mocha',
  ]);
});

test('existing items with the same names are not replaced or duplicated', () => {
  const missing = coffeeStartersToSync([{ id: 'custom-latte', name: ' iced LATTE ', price: 7.25, imageUrl: 'custom' }]);
  assert.equal(missing.length, 10);
  assert.ok(missing.every(item => item.slug !== 'iced-latte'));
});

test('only the earlier unpriced starter is upgraded', () => {
  const starter = { name: 'Iced Latte', slug: 'iced-latte', category: 'iced_coffee' };
  const original = { id: 'coffee-iced-latte', name: starter.name, category: 'iced_coffee', imagePath: 'defaultDrinks/iced-latte.png', price: 0 };
  assert.equal(isUnpricedStarter(original, starter), true);
  assert.deepEqual(coffeeStartersToSync([original]).map(item => item.slug).includes(starter.slug), true);
  assert.equal(isUnpricedStarter({ ...original, price: 6 }, starter), false);
  assert.equal(isUnpricedStarter({ ...original, imagePath: 'venues/custom.png' }, starter), false);
  assert.equal(isUnpricedStarter({ ...original, name: 'House Latte' }, starter), false);
});

test('hot starters use the hot coffee category and preserve edited prices', () => {
  const starter = { name: 'Latte', slug: 'latte', category: 'hot_coffee' };
  const original = { id: 'coffee-latte', name: 'Latte', category: 'hot_coffee', imagePath: 'defaultDrinks/latte.png', price: 0 };
  assert.equal(isUnpricedStarter(original, starter), true);
  assert.equal(isUnpricedStarter({ ...original, price: 6.5 }, starter), false);
  assert.equal(coffeeStartersToSync([{ ...original, price: 6.5 }]).some(item => item.slug === 'latte'), false);
});
