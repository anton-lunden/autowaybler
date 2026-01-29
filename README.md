# autowaybler

`autowaybler` is a scheduled job that finds the lowest upcoming electricity spot price and starts a charging session with that price as the limit — so you don't have to manually set one in the [Waybler](https://waybler.com) app every time you plug in.

## Usage

All you need is your Waybler credentials:

```sh
docker run -d \
  -e WAYBLER_EMAIL=you@example.com \
  -e WAYBLER_PASSWORD=secret \
  ghcr.io/anton-lunden/autowaybler
```

By default, it checks every hour between 17:00 and 23:00 whether your car is plugged in, finds the lowest spot price in the next 14 hours, and starts charging with that price as the limit.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WAYBLER_EMAIL` | *required* | Your Waybler email |
| `WAYBLER_PASSWORD` | *required* | Your Waybler password |
| `CRON` | `0 17-23 * * *` | How often to check (cron expression) |
| `TZ` | `Europe/Stockholm` | Timezone for the cron schedule |
| `LOOK_AHEAD_HOURS` | `14` | Hours ahead to find lowest price (max 24) |
| `MAX_SPOT_PRICE` | `1.5` | Max spot price incl. VAT (SEK/kWh), as shown in the Waybler app |

### Examples

Check every 30 minutes with a 12-hour lookahead:

```sh
docker run -d \
  -e WAYBLER_EMAIL=you@example.com \
  -e WAYBLER_PASSWORD=secret \
  -e CRON="*/30 * * * *" \
  -e LOOK_AHEAD_HOURS=12 \
  ghcr.io/anton-lunden/autowaybler
```

## How it works

On each scheduled tick:

1. Connects to Waybler and fetches live station data
2. Checks if a vehicle is plugged in and not already charging
3. Finds the lowest spot price in the look-ahead window
4. If the lowest price is within the max spot price limit, starts charging — Waybler pauses charging if the price goes above it

## Disclaimer

This project is not affiliated with or endorsed by Waybler.
