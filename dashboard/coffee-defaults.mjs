export const coffeeStarters = Object.freeze([
  { name: 'Iced Coffee', slug: 'iced-coffee', category: 'iced_coffee' },
  { name: 'Cold Brew', slug: 'cold-brew', category: 'iced_coffee' },
  { name: 'Iced Americano', slug: 'iced-americano', category: 'iced_coffee' },
  { name: 'Iced Latte', slug: 'iced-latte', category: 'iced_coffee' },
  { name: 'Iced Mocha', slug: 'iced-mocha', category: 'iced_coffee' },
  { name: 'Hot Coffee', slug: 'hot-coffee', category: 'hot_coffee' },
  { name: 'Americano', slug: 'americano', category: 'hot_coffee' },
  { name: 'Espresso', slug: 'espresso', category: 'hot_coffee' },
  { name: 'Latte', slug: 'latte', category: 'hot_coffee' },
  { name: 'Cappuccino', slug: 'cappuccino', category: 'hot_coffee' },
  { name: 'Mocha', slug: 'mocha', category: 'hot_coffee' },
]);

const normalizedName = name => String(name || '').trim().toLocaleLowerCase();

export function isUnpricedStarter(drink, starter) {
  return drink?.id === `coffee-${starter.slug}`
    && normalizedName(drink.name) === normalizedName(starter.name)
    && drink.category === starter.category
    && drink.imagePath === `defaultDrinks/${starter.slug}.png`
    && drink.sizePrices == null
    && Number(drink.price) === 0;
}

export function coffeeStartersToSync(drinks) {
  const names = new Set(drinks.map(drink => normalizedName(drink.name)));
  const byId = new Map(drinks.map(drink => [drink.id, drink]));
  return coffeeStarters.filter(starter =>
    !names.has(normalizedName(starter.name))
      || isUnpricedStarter(byId.get(`coffee-${starter.slug}`), starter));
}
