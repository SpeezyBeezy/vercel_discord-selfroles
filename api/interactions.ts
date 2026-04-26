// api/interactions.ts
// Vercel Edge Function — Discord Interactions Endpoint

export const config = { runtime: "edge" };

import {
  verifyDiscordSignature,
  deepSnakeCase,
  sendMessage,
  addRole,
  removeRole,
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

// ─── Component sanitizer ──────────────────────────────────────────────────────
// Discord message dumps include client-only fields like `id` ("0,0", "0,1")
// that the API rejects. We use an allowlist per component type to be safe.

const BUTTON_KEYS = new Set([
  "type", "custom_id", "style", "label", "emoji", "url", "disabled",
]);
const SELECT_KEYS = new Set([
  "type", "custom_id", "options", "placeholder", "min_values", "max_values", "disabled",
]);
const OPTION_KEYS = new Set([
  "label", "value", "description", "emoji", "default",
]);

function sanitizeComponent(c: Record<string, unknown>): Record<string, unknown> {
  const type = c.type as number;

  if (type === 1) {
    // Action row — only type + components
    const inner = c.components as Array<Record<string, unknown>> | undefined;
    return {
      type: 1,
      ...(inner ? { components: inner.map(sanitizeComponent) } : {}),
    };
  }

  if (type === 2) {
    // Button
    return Object.fromEntries(
      Object.entries(c).filter(([k]) => BUTTON_KEYS.has(k))
    );
  }

  if (type === 3) {
    // Select menu
    const out = Object.fromEntries(
      Object.entries(c).filter(([k]) => SELECT_KEYS.has(k))
    );
    if (Array.isArray(out.options)) {
      out.options = (out.options as Array<Record<string, unknown>>).map((opt) =>
        Object.fromEntries(Object.entries(opt).filter(([k]) => OPTION_KEYS.has(k)))
      );
    }
    return out;
  }

  // Unknown — strip the known bad key at minimum
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
    data: {
      content,
      flags: MessageFlags.EPHEMERAL,
    },
  });
}

// ─── /deploy-json handler ─────────────────────────────────────────────────────

async function handleDeployJson(interaction: Record<string, unknown>): Promise<Response> {
  const options = (interaction.data as Record<string, unknown>)?.options as
    | Array<{ name: string; value: string }>
    | undefined;

  const urlOption = options?.find((o) => o.name === "url");
  if (!urlOption?.value) {
    return ephemeralReply("❌ No URL provided.");
  }

  let raw: unknown;
  try {
    const res = await fetch(urlOption.value);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e: unknown) {
    return ephemeralReply(`❌ Failed to fetch JSON: ${(e as Error).message}`);
  }

  // Convert all keys to snake_case (handles camelCase from Discord client dumps)
  const converted = deepSnakeCase(raw) as Record<string, unknown>;

  // Build payload with only what the Discord API accepts, sanitizing components
  const payload: Record<string, unknown> = {};
  if (converted.content) payload.content = converted.content;
  if (converted.embeds)  payload.embeds  = converted.embeds;
  if (converted.components) payload.components = sanitizeComponents(converted.components);

  if (!payload.content && !payload.embeds && !payload.components) {
    return ephemeralReply("❌ JSON contained no `content`, `embeds`, or `components`.");
  }

  try {
    await sendMessage(interaction.channel_id as string, payload);
  } catch (e: unknown) {
    return ephemeralReply(`❌ Discord API error: ${(e as Error).message}`);
  }

  return ephemeralReply("✅ Message deployed successfully!");
}

// ─── Component interaction handler ───────────────────────────────────────────

async function handleComponent(interaction: Record<string, unknown>): Promise<Response> {
  const data       = interaction.data as Record<string, unknown>;
  const customId   = data?.custom_id as string | undefined;
  const compType   = data?.component_type as number | undefined;
  const member     = interaction.member as Record<string, unknown> | undefined;
  const userId     = (member?.user as Record<string, unknown>)?.id as string;
  const memberRoles = (member?.roles as string[]) ?? [];
  const guildId    = interaction.guild_id as string;

  if (!userId || !guildId) {
    return ephemeralReply("❌ This can only be used in a server.");
  }

  try {
    // Toggle button: srb-t-{roleId}
    if (compType === ComponentType.BUTTON && customId?.startsWith("srb-t-")) {
      const roleId = customId.slice("srb-t-".length);
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
      await addRole(guildId, userId, roleId);
      return ephemeralReply("✅ Role updated!");
    }
  } catch (e: unknown) {
    return ephemeralReply(`❌ Failed to update role: ${(e as Error).message}`);
  }

  return ephemeralReply("❌ Unknown component interaction.");
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return new Response("Server misconfigured: missing DISCORD_PUBLIC_KEY", { status: 500 });
  }

  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) {
    return new Response("Missing signature headers", { status: 401 });
  }

  const rawBody = await req.text();
  const isValid = await verifyDiscordSignature(publicKey, signature, timestamp, rawBody);
  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let interaction: Record<string, unknown>;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const type = interaction.type as number;

  if (type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  if (type === InteractionType.APPLICATION_COMMAND) {
    const name = (interaction.data as Record<string, unknown>)?.name as string;
    if (name === "deploy-json") return handleDeployJson(interaction);
    return ephemeralReply("❌ Unknown command.");
  }

  if (type === InteractionType.MESSAGE_COMPONENT) {
    return handleComponent(interaction);
  }

  return new Response("Unknown interaction type", { status: 400 });
}