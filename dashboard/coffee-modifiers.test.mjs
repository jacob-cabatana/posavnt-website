import assert from 'node:assert/strict';
import test from 'node:test';
import { coffeeModifierDefaults, validCoffeeModifierPrice } from './coffee-modifiers.mjs';

test('coffee modifier defaults are unique, free, and include expected restrictions', () => {
  assert.equal(coffeeModifierDefaults.length, 18);
  assert.equal(new Set(coffeeModifierDefaults.map(item => item.id)).size, 18);
  assert.equal(coffeeModifierDefaults.find(item => item.name === 'Extra espresso shot').modifierCoffeeType, 'non_espresso');
  assert.equal(coffeeModifierDefaults.find(item => item.name === 'No ice').modifierCoffeeType, 'iced');
});

test('owner upcharges are nonnegative dollars with cent precision', () => {
  assert.equal(validCoffeeModifierPrice(0), true);
  assert.equal(validCoffeeModifierPrice(.75), true);
  assert.equal(validCoffeeModifierPrice(-1), false);
  assert.equal(validCoffeeModifierPrice(.001), false);
});
