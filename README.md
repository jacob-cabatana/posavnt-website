# POS AVNT

Responsive product website for POS AVNT — a point-of-sale system built for bars, clubs, campus nightlife, and live events.

## Run locally

1. Open this folder in Visual Studio Code.
2. Open the integrated terminal.
3. Run `npm run dev`.
4. Visit [http://127.0.0.1:4173](http://127.0.0.1:4173).

The site uses plain HTML, CSS, and JavaScript. The owner dashboard uses the Firebase Web SDK loaded from Google's CDN.

## Edit the content

- Page copy and links: `index.html`
- Visual design and responsive layout: `styles.css`
- Navigation and reveal animations: `script.js`
- Client login: `client-login.html`
- Live owner dashboard: `dashboard/`

The dashboard signs in against AVNT Firebase (`avnt-832d8`) using the same venue-owner email and password as the iPad app. It only reads and writes `venues/{auth.uid}` and its child collections. Keep the venue-isolation Firestore Security Rules deployed; staff PINs do not grant website access.

Dashboard analytics are based on AVNT order records, not Stripe payout balances. The most recent 1,000 orders are loaded; the UI warns when the cap is reached. Run the calculations checks with `node --test dashboard/metrics.test.mjs`.
