# Discord Role Bot — Vercel Edge

Stateless Discord role-assignment bot running on **Vercel Edge Functions**.  
No Gateway. No WebSockets. No `discord.js`. Just raw HTTP and `crypto.subtle`.

---

## Features

| Interaction | Trigger | Behaviour |
|---|---|---|
| `/deploy-json [url]` | Admin only | Fetches a Discord message JSON dump, converts camelCase → snake_case, posts it to the current channel |
| Button click | `custom_id` starts with `srb-t-` | **Toggles** the role (add if missing, remove if present) |
| Select menu | `custom_id` = `select-roles` | **Adds** the chosen colour role to the member |

All role responses are **ephemeral** (only visible to the user who clicked).

---

## Project Structure

```
discord-role-bot/
├── api/
│   └── interactions.ts   ← Vercel Edge entry point
├── lib/
│   └── discord.ts        ← Sig verification + Discord REST helpers
├── scripts/
│   └── register.ts       ← One-time command registration
├── vercel.json            ← Forces Edge runtime
├── tsconfig.json
└── package.json
```

---

## Setup Guide

### 1 — Create a Discord Application

1. Go to <https://discord.com/developers/applications> → **New Application**.
2. Under **Bot** → enable **Server Members Intent** (needed to read member roles).
3. Copy your **Application ID**, **Public Key**, and **Bot Token**.

### 2 — Invite the Bot

Use this URL (replace `YOUR_APP_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=268435456
```

The `268435456` permission grants **Manage Roles**. Make sure the bot's role sits **above** any role it will assign in the server's role hierarchy.

### 3 — Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Clone / enter the project
cd discord-role-bot

# Deploy
vercel deploy --prod
```

Note your deployment URL, e.g. `https://your-bot.vercel.app`.

### 4 — Set Environment Variables

In the Vercel dashboard → **Settings → Environment Variables** (or via CLI):

| Variable | Value |
|---|---|
| `DISCORD_PUBLIC_KEY` | From Discord Developer Portal → your app → General Information |
| `DISCORD_BOT_TOKEN` | From Discord Developer Portal → your app → Bot |
| `DISCORD_APPLICATION_ID` | From Discord Developer Portal → your app → General Information |
| `DISCORD_GUILD_ID` | *(optional)* Your server ID — set only for dev/instant registration |

### 5 — Register the Interactions Endpoint

In Discord Developer Portal → your app → **General Information**:

```
Interactions Endpoint URL: https://your-bot.vercel.app/api/interactions
```

Discord will send a PING to verify the endpoint. If it shows ✅ you're good.

### 6 — Register the `/deploy-json` Slash Command

```bash
# Install dev deps
npm install

# Set env vars locally (or use a .env file + dotenv)
export DISCORD_BOT_TOKEN=...
export DISCORD_APPLICATION_ID=...
export DISCORD_GUILD_ID=...   # optional: guild-scoped = instant

# Run the registration script
npm run register
```

---

## Using `/deploy-json`

1. Export any Discord message as JSON (e.g. via a browser extension or the API).
2. Host the JSON file anywhere publicly accessible (GitHub Gist raw URL works great).
3. Run `/deploy-json url:https://gist.githubusercontent.com/.../message.json` in your server.

The bot will:
- Fetch the JSON
- Recursively convert all keys from camelCase → snake_case
- Extract `content`, `embeds`, `components`
- POST the message to the current channel

### Supported Button JSON format
```json
{
  "customId": "srb-t-1450335764494946414",
  "style": 1,
  "label": "Degenerate",
  "emoji": { "name": "🔥" }
}
```
→ `custom_id` prefix `srb-t-` followed by the role ID.

### Supported Select Menu JSON format
```json
{
  "customId": "select-roles",
  "options": [
    { "label": "Cherry Rose", "value": "1483806504451833937" }
  ],
  "placeholder": "Select your color role!",
  "minValues": 0,
  "maxValues": 1
}
```

---

## Security

- All interactions are verified using **Ed25519 signatures** via `crypto.subtle` (Web Crypto API) — no Node.js `crypto` module needed.
- `/deploy-json` requires **Administrator** (`default_member_permissions: "8"`).
- No data is stored anywhere — completely stateless.

---

## Local Development

```bash
vercel dev
```

Then use [ngrok](https://ngrok.com/) or [cloudflared tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) to expose your local server, and temporarily set that URL as the Interactions Endpoint in the Developer Portal.
# vercel_discord-selfroles
# selfrole_templates
# vercel_discord-selfroles
