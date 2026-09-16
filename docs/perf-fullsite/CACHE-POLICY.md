# /api/* cache classification (Phase 2)

**Rule:** never blanket-cache all `/api/*`. Default remains `no-store`.

## Allow-listed public / read-mostly (short SWR)

| Path | Cache | Why safe |
|---|---|---|
| `GET /api/public/companions` (list, no id) | max-age=15, s-maxage=30, SWR=60 | Public hall cards; presence may lag ≤30s (accepted) |
| `GET /api/home/daily-stats` | max-age=30, s-maxage=60, SWR=120 | Aggregate trust metrics; + process mem TTL 45s |
| `GET /api/platform/services` | max-age=30, s-maxage=60, SWR=120 | Public service catalog |

Detail `GET /api/public/companions?id=` stays **no-store** (signed voice URLs / HEAD gate).

## Must stay no-store (never edge-cache)

- Auth / OTP / session (`/api/auth*`, login portals)
- Orders / payments / wallet / recharge
- User-private profile, messages, notifications
- Companion workbench mutations & personal earnings
- Admin mutations
- Forced-ack write paths

## Forbidden failure modes this policy avoids

- Boss A seeing Boss B data via shared CDN cache
- Stale order status after pay/cancel
- Companion online/offline frozen for minutes
- Price catalog stuck across admin edits beyond SWR window
- OTP / login session anomalies from cached auth responses
