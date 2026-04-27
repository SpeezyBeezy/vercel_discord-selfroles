// scripts/sync-roles.ts
// Reads a deployed JSON file and prints the ALLOWED_ROLE_IDS value to set in Vercel.
// Usage: npx tsx scripts/sync-roles.ts https://raw.githubusercontent.com/.../buttons.json
//
// It also accepts multiple URLs (one per JSON file) and merges all role IDs:
//   npx tsx scripts/sync-roles.ts https://.../buttons.json https://.../select.json

async function extractRoleIds(url: string): Promise<string[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  const json = await res.json();

  const ids = new Set<string>();
  const SNOWFLAKE = /^\d{17,20}$/;

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }

    const obj = node as Record<string, unknown>;

    // Button: custom_id or customId starting with srb-t-
    const customId = (obj.customId ?? obj.custom_id) as string | undefined;
    if (typeof customId === "string" && customId.startsWith("srb-t-")) {
      const roleId = customId.slice("srb-t-".length);
      if (SNOWFLAKE.test(roleId)) ids.add(roleId);
    }

    // Select menu: options[].value
    if (Array.isArray(obj.options)) {
      for (const opt of obj.options as Array<Record<string, unknown>>) {
        const val = opt.value as string | undefined;
        if (typeof val === "string" && SNOWFLAKE.test(val)) ids.add(val);
      }
    }

    // Recurse into all values
    Object.values(obj).forEach(walk);
  }

  walk(json);
  return [...ids];
}

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: npx tsx scripts/sync-roles.ts <url> [url2] [url3...]");
    process.exit(1);
  }

  const allIds = new Set<string>();
  for (const url of urls) {
    console.log(`Scanning: ${url}`);
    const ids = await extractRoleIds(url);
    ids.forEach((id) => allIds.add(id));
    console.log(`  Found ${ids.length} role ID(s): ${ids.join(", ")}`);
  }

  console.log("\n─── Set this in Vercel Environment Variables ───────────────────");
  console.log(`ALLOWED_ROLE_IDS=${[...allIds].join(",")}`);
  console.log("────────────────────────────────────────────────────────────────");
  console.log("\nOr via Vercel CLI:");
  console.log(`vercel env add ALLOWED_ROLE_IDS`);
  console.log(`# paste the value above when prompted`);
}

main().catch((e) => { console.error(e); process.exit(1); });