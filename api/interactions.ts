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

// ─── JSON response helper ─────────────────────────────────────────────────────

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

  const url = urlOption.value;

  let raw: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (e: unknown) {
    return ephemeralReply(`❌ Failed to fetch JSON: ${(e as Error).message}`);
  }

  // Convert all keys to snake_case (handles camelCase from Discord message dumps)
  const converted = deepSnakeCase(raw) as Record<string, unknown>;

  // Extract only what Discord accepts for message creation
  const payload: Record<string, unknown> = {};
  if (converted.content) payload.content = converted.content;
  if (converted.embeds) payload.embeds = converted.embeds;
  if (converted.components) payload.components = converted.components;

  if (!payload.content && !payload.embeds && !payload.components) {
    return ephemeralReply("❌ JSON contained no `content`, `embeds`, or `components`.");
  }

  const channelId = interaction.channel_id as string;
  try {
    await sendMessage(channelId, payload);
  } catch (e: unknown) {
    return ephemeralReply(`❌ Discord API error: ${(e as Error).message}`);
  }

  return ephemeralReply("✅ Message deployed successfully!");
}

// ─── Component interaction handler ───────────────────────────────────────────

async function handleComponent(interaction: Record<string, unknown>): Promise<Response> {
  const data = interaction.data as Record<string, unknown>;
  const customId = data?.custom_id as string | undefined;
  const componentType = data?.component_type as number | undefined;

  const member = interaction.member as Record<string, unknown> | undefined;
  const userId = (member?.user as Record<string, unknown>)?.id as string;
  const memberRoles = (member?.roles as string[]) ?? [];
  const guildId = interaction.guild_id as string;

  if (!userId || !guildId) {
    return ephemeralReply("❌ This can only be used in a server.");
  }

  try {
    // ── Toggle Button: srb-t-{roleId} ──────────────────────────────────────
    if (componentType === ComponentType.BUTTON && customId?.startsWith("srb-t-")) {
      const roleId = customId.slice("srb-t-".length);
      const hasRole = memberRoles.includes(roleId);

      if (hasRole) {
        await removeRole(guildId, userId, roleId);
        return ephemeralReply("✅ Role removed!");
      } else {
        await addRole(guildId, userId, roleId);
        return ephemeralReply("✅ Role added!");
      }
    }

    // ── Select Menu: select-roles ───────────────────────────────────────────
    if (componentType === ComponentType.SELECT_MENU && customId === "select-roles") {
      const values = data?.values as string[] | undefined;
      const roleId = values?.[0];

      if (!roleId) {
        return ephemeralReply("✅ No role selected.");
      }

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

  // ── Verify Discord signature ──────────────────────────────────────────────
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

  // ── Parse and route interaction ───────────────────────────────────────────
  let interaction: Record<string, unknown>;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const type = interaction.type as number;

  // PING — Discord connectivity check
  if (type === InteractionType.PING) {
    return jsonResponse({ type: InteractionResponseType.PONG });
  }

  // Slash command
  if (type === InteractionType.APPLICATION_COMMAND) {
    const commandName = (interaction.data as Record<string, unknown>)?.name as string;
    if (commandName === "deploy-json") {
      return handleDeployJson(interaction);
    }
    return ephemeralReply("❌ Unknown command.");
  }

  // Message component (button / select)
  if (type === InteractionType.MESSAGE_COMPONENT) {
    return handleComponent(interaction);
  }

  return new Response("Unknown interaction type", { status: 400 });
}
