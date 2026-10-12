import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedCoffeeImagePath } from './coffee-images.mjs';

test('starter coffee items use AVNT shared Storage images', () => {
  for (const name of ['Iced Coffee', 'Cold Brew', 'Iced Americano', 'Iced Latte', 'Iced Mocha']) {
    const slug = name.toLowerCase().replaceAll(' ', '-');
    assert.equal(sharedCoffeeImagePath({ name }), `defaultDrinks/${slug}.png`);
  }
});

test('venue image overrides and unrelated products are left alone', () => {
  assert.equal(sharedCoffeeImagePath({ name: 'Iced Latte', imageUrl: 'https://example.com/custom.png' }), null);
  assert.equal(sharedCoffeeImagePath({ name: 'Iced Latte', imagePath: 'venues/venue/drinks/latte.png' }), null);
  assert.equal(sharedCoffeeImagePath({ name: 'Vanilla Latte' }), null);
});
