# FreshWay API Worker

This Worker provides the shared notification layer for FreshWay.

## D1

Create the database:

```bash
npx wrangler d1 create freshway
```

Copy the returned database ID into `wrangler.jsonc`, then apply the schema:

```bash
npx wrangler d1 execute freshway --file=./schema.sql --remote
```

## Web Push

Generate VAPID credentials locally:

```bash
npx web-push generate-vapid-keys
```

Set them as Worker secrets:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npx wrangler secret put ADMIN_TOKEN
```

The customer app never receives the private VAPID key or admin token.

## WhatsApp

Configure Meta WhatsApp Business Platform / Cloud API credentials as Worker secrets/vars:

```bash
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
```

Set `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_GRAPH_VERSION` in the Worker environment. Use only customers with recorded WhatsApp opt-in. Broadcasts must use an approved WhatsApp template when required by Meta's messaging rules.

## Routes

- `GET /api/health`
- `GET /api/push/public-key`
- `POST /api/push/subscribe`
- `POST /api/customers/register`
- `POST /api/notifications/broadcast` — requires `Authorization: Bearer <ADMIN_TOKEN>`

For production, route `/api/*` from the same FreshWay domain to this Worker so the static customer/admin pages can use relative API URLs.
