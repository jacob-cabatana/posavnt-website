const paidStates = new Set(['paid', 'partially_refunded', 'refunded']);

function cents(value, dollars) {
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Math.round(Number(value));
  return Number.isFinite(Number(dollars)) ? Math.round(Number(dollars) * 100) : 0;
}

function dateOf(value) {
  if (value?.toDate) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function shiftDateKey(key, days) {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function businessNightKey(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const key = `${parts.year}-${parts.month}-${parts.day}`;
  return Number(parts.hour) < 18 ? shiftDateKey(key, -1) : key;
}

export function normalizedOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemSubtotal = items.reduce((sum, item) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    return sum + cents(item.lineTotalCents, item.lineTotal ??
      ((Number(item.price) || Number(item.priceCents) / 100 || 0) * quantity));
  }, 0);
  const subtotal = itemSubtotal || cents(order.subtotalCents, order.subtotal);
  const gratuity = cents(order.automaticGratuityCents);
  const additionalTip = cents(order.tipCents, order.tip);
  const venueTax = cents(order.venueTaxCents, order.venueTax);
  const feeTax = order.venuePaysPOSFees === true ? 0 : cents(order.backstageTaxCents, order.backstageTax);
  const customerFee = order.venuePaysPOSFees === true ? 0 : cents(order.backstageFeeCents);
  const charged = cents(order.customerTotalCents ?? order.totalCents, order.total) ||
    subtotal + gratuity + additionalTip + venueTax + feeTax + customerFee;
  return {
    ...order,
    saleDate: dateOf(order.paidAt) || dateOf(order.pickedUpAt) || dateOf(order.createdAt),
    subtotalCents: subtotal,
    tipTotalCents: gratuity + additionalTip,
    venueTaxCents: venueTax,
    feeTaxCents: feeTax,
    customerFeeCents: customerFee,
    chargedCents: charged,
    refundedCents: Math.max(0, cents(order.refundedAmountCents)),
    itemCount: items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0),
  };
}

export function isReportableSale(order) {
  if ((order.paymentStatus || '').toLowerCase() === 'canceled' || order.status === 'cancelled') return false;
  return paidStates.has((order.paymentStatus || '').toLowerCase()) ||
    Boolean(dateOf(order.paidAt)) || order.stripePaymentStatus === 'succeeded';
}

export function calculateMetrics(orders, period, options = {}) {
  const now = options.now || new Date();
  const timeZone = options.timeZone || 'America/New_York';
  const today = dateKey(now, timeZone);
  const currentNight = businessNightKey(now, timeZone);
  const firstDay = period === '30' ? shiftDateKey(today, -29) : shiftDateKey(today, -6);
  const included = orders.filter(isReportableSale).map(normalizedOrder).filter(order => {
    if (!order.saleDate) return false;
    if (period === 'tonight') return businessNightKey(order.saleDate, timeZone) === currentNight;
    return dateKey(order.saleDate, timeZone) >= firstDay && order.saleDate <= now;
  }).sort((a, b) => b.saleDate - a.saleDate);
  const totals = {
    orders: included.length, items: 0, salesCents: 0, tipsCents: 0,
    venueTaxCents: 0, feeTaxCents: 0, customerFeeCents: 0,
    chargedCents: 0, refundedCents: 0, cardCents: 0, cashCents: 0,
  };
  const sellers = new Map();
  const days = new Map();
  for (const order of included) {
    totals.items += order.itemCount;
    totals.salesCents += order.subtotalCents;
    totals.tipsCents += order.tipTotalCents;
    totals.venueTaxCents += order.venueTaxCents;
    totals.feeTaxCents += order.feeTaxCents;
    totals.customerFeeCents += order.customerFeeCents;
    totals.chargedCents += order.chargedCents;
    totals.refundedCents += order.refundedCents;
    if (order.paymentMethod === 'cash') totals.cashCents += order.chargedCents;
    else totals.cardCents += order.chargedCents;
    const key = dateKey(order.saleDate, timeZone);
    days.set(key, (days.get(key) || 0) + order.subtotalCents);
    for (const item of order.items || []) {
      const name = String(item.name || 'Drink').trim();
      const current = sellers.get(name) || { name, quantity: 0, revenueCents: 0 };
      const quantity = Math.max(1, Number(item.quantity) || 1);
      current.quantity += quantity;
      current.revenueCents += cents(item.lineTotalCents, item.lineTotal ??
        ((Number(item.price) || Number(item.priceCents) / 100 || 0) * quantity));
      sellers.set(name, current);
    }
  }
  return {
    ...totals,
    netCollectedCents: Math.max(0, totals.chargedCents - totals.refundedCents),
    averageSaleCents: totals.orders ? Math.round(totals.salesCents / totals.orders) : 0,
    ordersList: included,
    topSellers: [...sellers.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5),
    dailySales: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}
