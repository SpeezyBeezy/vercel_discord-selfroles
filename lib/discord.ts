// lib/discord.ts
// Utilities for Discord signature verification and API requests

const DISCORD_API_BASE = "https://discord.com/api/v10";

// ─── Signature Verification ───────────────────────────────────────────────────

export async function verifyDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> {
  try {
    const keyBytes = hexToUint8Array(publicKey);
    const sigBytes = hexToUint8Array(signature);
    const msgBytes = new TextEncoder().encode(timestamp + body);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"]
    );

    return await crypto.subtle.verify("Ed25519", cryptoKey, sigBytes, msgBytes);
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((byte) => parseInt(byte, 16)));
}

// ─── camelCase / PascalCase → snake_case conversion ──────────────────────────

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (match) => `_${match.toLowerCase()}`)
    .replace(/^_/, "");
}

export function deepSnakeCase(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(deepSnakeCase);
  }
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        toSnakeCase(k),
        deepSnakeCase(v),
      ])
    );
  }
  return obj;
}

// ─── Discord REST helpers ─────────────────────────────────────────────────────

async function discordRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not set");

  const headers: Record<string, string> = {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return res;
}

export async function sendMessage(
  channelId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const res = await discordRequest("POST", `/channels/${channelId}/messages`, payload);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to send message: ${res.status} ${err}`);
  }
}

export async function addRole(
  guildId: string,
  userId: string,
  roleId: string
): Promise<void> {
  const res = await discordRequest(
    "PUT",
    `/guilds/${guildId}/members/${userId}/roles/${roleId}`
  );
  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(`Failed to add role: ${res.status} ${err}`);
  }
}

export async function removeRole(
  guildId: string,
  userId: string,
  roleId: string
): Promise<void> {
  const res = await discordRequest(
    "DELETE",
    `/guilds/${guildId}/members/${userId}/roles/${roleId}`
  );
  if (!res.ok && res.status !== 204) {
    const err = await res.text();
    throw new Error(`Failed to remove role: ${res.status} ${err}`);
  }
}
