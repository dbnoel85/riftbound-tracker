# Riftbound Tracker

A phone app (installable web app) for tracking a Riftbound TCG collection.

**Open the app:** https://dbnoel85.github.io/riftbound-tracker/

- **Scan** cards with the phone camera (reads the card number/name and matches the artwork), or **add** them by searching.
- Every printing is covered: all sets, promos, alternate arts, signatures, overnumbered, normal and foil.
- **TCGplayer market prices** refresh daily; **weekly change** in $ and % for each card and the whole collection.
- **Top movers**: biggest gainers and losers, for your cards or all of Riftbound.
- **New sets** are picked up automatically.
- Your collection lives on your phone (with backup/restore and CSV export).

## How it works
`.github/workflows/update.yml` runs every day. It runs `scripts/update_prices.py`, which downloads the Riftbound catalog and prices
from [tcgcsv.com](https://tcgcsv.com) (a daily mirror of TCGplayer data), saves them in `data/`, and republishes the site on GitHub Pages.

To force a refresh: **Actions → Update prices and publish app → Run workflow**.

Not affiliated with Riot Games or TCGplayer.
