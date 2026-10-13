export function payoutAlert(status) {
  if (status.ready && !status.testMode) return null;
  if (status.testMode && status.ready) {
    return {
      title: 'Stripe is in test mode',
      detail: 'Test payments work, but you cannot accept real payments or receive payouts until live Stripe setup is complete.',
      action: 'View Stripe status →',
    };
  }
  if (status.testMode) {
    return {
      title: 'Finish Stripe test setup',
      detail: 'Connect your Stripe test account before testing card payments. Live payments will require live payout setup later.',
      action: 'Set up Stripe →',
    };
  }
  return {
    title: status.connected ? 'Finish your payout setup' : 'Set up payouts before accepting payments',
    detail: 'Your venue cannot accept live card payments until Stripe enables its payment and payout account.',
    action: 'Set up payouts →',
  };
}
