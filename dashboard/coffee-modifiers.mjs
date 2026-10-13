export const coffeeModifierDefaults = Object.freeze([
  ['vanilla-syrup', 'Vanilla syrup', 'Syrups', 'all', null],
  ['caramel', 'Caramel', 'Syrups', 'all', null],
  ['hazelnut', 'Hazelnut', 'Syrups', 'all', null],
  ['brown-sugar', 'Brown sugar', 'Syrups', 'all', null],
  ['sugar-free-vanilla', 'Sugar-free vanilla', 'Syrups', 'all', null],
  ['whole-milk', 'Whole milk', 'Milk', 'all', 'milk'],
  ['skim-milk', 'Skim milk', 'Milk', 'all', 'milk'],
  ['oat-milk', 'Oat milk', 'Milk', 'all', 'milk'],
  ['almond-milk', 'Almond milk', 'Milk', 'all', 'milk'],
  ['soy-milk', 'Soy milk', 'Milk', 'all', 'milk'],
  ['extra-espresso-shot', 'Extra espresso shot', 'Extras', 'non_espresso', null],
  ['whipped-cream', 'Whipped cream', 'Extras', 'all', null],
  ['cold-foam', 'Cold foam', 'Extras', 'iced', null],
  ['decaf', 'Decaf', 'Preparation', 'all', 'caffeine'],
  ['half-caf', 'Half-caf', 'Preparation', 'all', 'caffeine'],
  ['extra-hot', 'Extra hot', 'Preparation', 'hot', null],
  ['light-ice', 'Light ice', 'Preparation', 'iced', 'ice'],
  ['no-ice', 'No ice', 'Preparation', 'iced', 'ice'],
].map(([slug, name, modifierGroup, modifierCoffeeType, modifierExclusiveGroup]) =>
  ({ id: `coffee-modifier-${slug}`, name, modifierGroup, modifierCoffeeType, modifierExclusiveGroup })));

export const coffeeModifierGroups = Object.freeze(['Syrups', 'Milk', 'Extras', 'Preparation']);
export const coffeeModifierTypes = Object.freeze({ all: 'All coffee', hot: 'Hot only',
  iced: 'Iced only', non_espresso: 'Except espresso' });

export function validCoffeeModifierPrice(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 100000
    && Math.abs(amount * 100 - Math.round(amount * 100)) < .000001;
}
