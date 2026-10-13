export const usesCoffeeSizes = item =>
  ['hot_coffee', 'iced_coffee'].includes(item?.category);

export const isEspresso = item => item?.category === 'hot_coffee'
  && String(item?.name || '').trim().toLowerCase() === 'espresso';

export function coffeeSizePrices(item) {
  const small = Number(item?.sizePrices?.small ?? item?.price);
  return {
    small,
    medium: Number(item?.sizePrices?.medium ?? (small + 1)),
    large: Number(item?.sizePrices?.large ?? (small + 2)),
  };
}

export function validCoffeeSizePrices(prices) {
  return Object.values(prices).every(value => Number.isFinite(value) && value <= 100000
      && Math.abs(Math.round(value * 100) - value * 100) < 0.000001)
    && prices.small > 0 && prices.small <= prices.medium && prices.medium <= prices.large;
}
