// api/interactions.ts
// Vercel Edge Function — Discord Interactions Endpoint

export const config = { runtime: "edge" };

import {
  verifyDiscordSignature,
  deepSnakeCase,
  sendMessage,
  addRole,
  removeRole,
  type AttachmentInput,
} from "../lib/discord";

// ─── Discord Interaction Types ────────────────────────────────────────────────

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
} as const;

const MessageFlags = {
  EPHEMERAL: 64,
} as const;

const ComponentType = {
  BUTTON: 2,
  SELECT_MENU: 3,
} as const;

// ─── Role Allowlist ───────────────────────────────────────────────────────────
// ALLOWED_ROLE_IDS is a comma-separated list of role IDs set in the environment.
// The bot will NEVER assign or remove a role that isn't on this list,
// regardless of what custom_id or select value arrives in the interaction.
//
// Example env var:
//   ALLOWED_ROLE_IDS=1450335764494946414,1483841417057927260,1483841511949992066
//
// To populate this automatically from a deployed JSON, run:
//   npm run sync-roles -- https://your-json-url

function getAllowedRoles(): Set<string> {
  const raw = process.env.ALLOWED_ROLE_IDS ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s)); // must be numeric snowflake IDs only
  return new Set(ids);
}

function assertRoleAllowed(roleId: string): void {
  // Validate format first — must be a Discord snowflake (17-20 digit number)
  if (!/^\d{17,20}$/.test(roleId)) {
    throw new Error(`Invalid role ID format: ${roleId}`);
  }

  const allowed = getAllowedRoles();

  // If no allowlist is configured at all, fail closed — never open
  if (allowed.size === 0) {
    throw new Error(
      "No ALLOWED_ROLE_IDS configured. The bot refuses to assign roles until an allowlist is set."
    );
  }

  if (!allowed.has(roleId)) {
    throw new Error(`Role ${roleId} is not on the allowlist.`);
  }
}

// ─── Guild Allowlist ──────────────────────────────────────────────────────────
// Prevent replayed interactions from other servers from working on your guild.
// Set ALLOWED_GUILD_ID to your server's ID in env vars.

function assertGuildAllowed(guildId: string): void {
  const allowed = process.env.ALLOWED_GUILD_ID?.trim();
  if (!allowed) return; // optional — warn in readme but don't hard-fail if unset
  if (guildId !== allowed) {
    throw new Error(`Interaction from unexpected guild: ${guildId}`);
  }
}

// ─── Component sanitizer ──────────────────────────────────────────────────────

const BUTTON_KEYS = new Set(["type","custom_id","style","label","emoji","url","disabled"]);
const SELECT_KEYS = new Set(["type","custom_id","options","placeholder","min_values","max_values","disabled"]);
const OPTION_KEYS = new Set(["label","value","description","emoji","default"]);

function sanitizeComponent(c: Record<string, unknown>): Record<string, unknown> {
  const type = c.type as number;
  if (type === 1) {
    const inner = c.components as Array<Record<string, unknown>> | undefined;
    return { type: 1, ...(inner ? { components: inner.map(sanitizeComponent) } : {}) };
  }
  if (type === 2) {
    return Object.fromEntries(Object.entries(c).filter(([k]) => BUTTON_KEYS.has(k)));
  }
  if (type === 3) {
    const out = Object.fromEntries(Object.entries(c).filter(([k]) => SELECT_KEYS.has(k)));
    if (Array.isArray(out.options)) {
      out.options = (out.options as Array<Record<string, unknown>>).map((opt) =>
        Object.fromEntries(Object.entries(opt).filter(([k]) => OPTION_KEYS.has(k)))
      );
    }
    return out;
  }
  const { id: _id, ...rest } = c as Record<string, unknown> & { id?: unknown };
  return rest;
}

function sanitizeComponents(components: unknown): unknown {
  if (!Array.isArray(components)) return components;
  return components.map((c) => sanitizeComponent(c as Record<string, unknown>));
}

// ─── JSON response helpers ────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ephemeralReply(content: string): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: MessageFlags.EPHEMERAL },
  });
}

// ─── /deploy-json handler ─────────────────────────────────────────────────────

async function handleDeployJson(interaction: Record<string, unknown>): Promise<Response> {
  const options = (interaction.data as Record<string, unknown>)?.options as
    | Array<{ name: string; value: string }>
    | undefined;

  const urlOption = options?.find((o) => o.name === "url");
  if (!urlOption?.value) return ephemeralReply("❌ No URL provided.");

  let raw: unknown;
  try {
    const res = await fetch(urlOption.value);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e: unknown) {
    return ephemeralReply(`❌ Failed to fetch JSON: ${(e as Error).message}`);
  }

  const converted = deepSnakeCase(raw) as Record<string, unknown>;

  const rawAttachments = converted.attachments as Array<Record<string, unknown>> | undefined;
  const attachments: AttachmentInput[] = (rawAttachments ?? [])
    .filter((a) => typeof a.url === "string" && a.url.length > 0)
    .map((a) => ({ url: a.url as string, spoiler: Boolean(a.spoiler) }));

  const payload: Record<string, unknown> = {};
  if (converted.content)    payload.content    = converted.content;
  if (converted.embeds)     payload.embeds     = converted.embeds;
  if (converted.components) payload.components = sanitizeComponents(converted.components);

  if (!payload.content && !payload.embeds && !payload.components && attachments.length === 0) {
    return ephemeralReply("❌ JSON contained no `content`, `embeds`, `components`, or `attachments`.");
  }

  try {
    await sendMessage(interaction.channel_id as string, payload, attachments);
  } catch (e: unknown) {
    return ephemeralReply(`❌ Discord API error: ${(e as Error).message}`);
  }

  return ephemeralReply("✅ Message deployed successfully!");
}

// ─── Component interaction handler ───────────────────────────────────────────

async function handleComponent(interaction: Record<string, unknown>): Promise<Response> {
  const data        = interaction.data as Record<string, unknown>;
  const customId    = data?.custom_id as string | undefined;
  const compType    = data?.component_type as number | undefined;
  const member      = interaction.member as Record<string, unknown> | undefined;
  const userId      = (member?.user as Record<string, unknown>)?.id as string;
  const memberRoles = (member?.roles as string[]) ?? [];
  const guildId     = interaction.guild_id as string;

  if (!userId || !guildId) return ephemeralReply("❌ This can only be used in a server.");

  // ── Guild check — reject interactions from other servers ─────────────────
  try {
    assertGuildAllowed(guildId);
  } catch {
    // Silently reject — don't leak info about why
    return new Response("Forbidden", { status: 403 });
  }

  try {
    // Toggle button: srb-t-{roleId}
    if (compType === ComponentType.BUTTON && customId?.startsWith("srb-t-")) {
      const roleId = customId.slice("srb-t-".length);

      // 🔒 Allowlist check — hard reject before any API call
      assertRoleAllowed(roleId);

      if (memberRoles.includes(roleId)) {
        await removeRole(guildId, userId, roleId);
        return ephemeralReply("✅ Role removed!");
      } else {
        await addRole(guildId, userId, roleId);
        return ephemeralReply("✅ Role added!");
      }
    }

    // Select menu: select-roles
    if (compType === ComponentType.SELECT_MENU && customId === "select-roles") {
      const roleId = (data?.values as string[] | undefined)?.[0];
      if (!roleId) return ephemeralReply("✅ No role selected.");

      // 🔒 Allowlist check — hard reject before any API call
      assertRoleAllowed(roleId);

      await addRole(guildId, userId, roleId);
      return ephemeralReply("✅ Role updated!");
    }
  } catch (e: unknown) {
    // Don't leak which roles are valid or why it failed
    console.error("Role assignment blocked:", (e as Error).message);
    return ephemeralReply("❌ That role cannot be assigned.");
  }

  return ephemeralReply("❌ Unknown component interaction.");
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) return new Response("Server misconfigured: missing DISCORD_PUBLIC_KEY", { status: 500 });

  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return new Response("Missing signature headers", { status: 401 });

  const rawBody = await req.text();
  const isValid = await verifyDiscordSignature(publicKey, signature, timestamp, rawBody);
  if (!isValid) return new Response("Invalid signature", { status: 401 });

  let interaction: Record<string, unknown>;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const type = interaction.type as number;

  if (type === InteractionType.PING) return jsonResponse({ type: InteractionResponseType.PONG });

  if (type === InteractionType.APPLICATION_COMMAND) {
    const name = (interaction.data as Record<string, unknown>)?.name as string;
    if (name === "deploy-json") return handleDeployJson(interaction);
    return ephemeralReply("❌ Unknown command.");
  }

  if (type === InteractionType.MESSAGE_COMPONENT) return handleComponent(interaction);

  return new Response("Unknown interaction type", { status: 400 });
}