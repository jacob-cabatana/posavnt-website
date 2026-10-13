const coffeeNames = new Set([
  'iced-coffee', 'cold-brew', 'iced-americano', 'iced-latte', 'iced-mocha',
  'hot-coffee', 'americano', 'espresso', 'latte', 'cappuccino', 'mocha',
]);

export function sharedCoffeeImagePath(drink) {
  if (typeof drink?.imageUrl === 'string' && drink.imageUrl.trim()) return null;
  const existingPath = String(drink?.imagePath || '');
  if (existingPath && !existingPath.startsWith('defaultDrinks/')) return null;

  if ([...coffeeNames].some(slug => existingPath === `defaultDrinks/${slug}.png`)) return existingPath;

  const slug = String(drink?.name || '').toLowerCase().replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return coffeeNames.has(slug) ? `defaultDrinks/${slug}.png` : null;
}
