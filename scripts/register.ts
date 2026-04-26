// scripts/register.ts
// Run once to register slash commands with Discord.
// Usage: npx ts-node scripts/register.ts
// (or: npx tsx scripts/register.ts)

const DISCORD_API_BASE = "https://discord.com/api/v10";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;

// Optionally scope to a single guild for instant updates during dev.
// Leave blank to register globally (takes ~1 hour to propagate).
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";

if (!BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN env var");
if (!APPLICATION_ID) throw new Error("Missing DISCORD_APPLICATION_ID env var");

const commands = [
  {
    name: "deploy-json",
    description: "Fetch a Discord message JSON from a URL and post it to this channel.",
    // Administrator only (permission bit 8 = 0x8)
    default_member_permissions: "8",
    options: [
      {
        type: 3, // STRING
        name: "url",
        description: "Public URL pointing to a Discord message JSON dump.",
        required: true,
      },
    ],
  },
];

async function register() {
  const endpoint = GUILD_ID
    ? `${DISCORD_API_BASE}/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`
    : `${DISCORD_API_BASE}/applications/${APPLICATION_ID}/commands`;

  console.log(`Registering commands to: ${endpoint}`);

  const res = await fetch(endpoint, {
    method: "PUT", // Bulk overwrite
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ Failed to register commands: ${res.status}\n${body}`);
    process.exit(1);
  }

  const registered = await res.json();
  console.log("✅ Commands registered:");
  for (const cmd of registered as Array<{ name: string; id: string }>) {
    console.log(`  /${cmd.name}  (id: ${cmd.id})`);
  }
}

register();
