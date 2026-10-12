# POS AVNT website

Static source for the POS AVNT marketing website and live owner dashboard.

## Structure

- `index.html` — public marketing homepage
- `client-login.html` — Firebase Email/Password venue-owner login
- `dashboard/` — live AVNT analytics, menu, nights, and venue settings
- `assets/` — POS product screenshots

## Important

The dashboard signs in against AVNT Firebase (`avnt-832d8`). It only reads and
writes `venues/{auth.uid}` and its child collections. Firestore Security Rules
must remain deployed so authenticated owners cannot access other venues.
Staff PINs do not grant website access. Dashboard analytics come from AVNT order
records, not Stripe payout or balance calculations. The last 1,000 order records
are loaded; the UI warns if that cap is reached.

Serve the repository root with any static web server. For example:

```sh
python3 -m http.server 4173
```

Run analytics checks with `node --test dashboard/metrics.test.mjs`.

Starter coffee menu artwork is stored in the AVNT Firebase Storage bucket under
`defaultDrinks/{iced-coffee,cold-brew,iced-americano,iced-latte,iced-mocha}.png`.
The dashboard resolves these shared images for matching menu items, while a
venue's uploaded `imageUrl` takes precedence. The iPad app retains bundled
copies so these items remain visible without a network connection.
