// Cargar .env.local manualmente (no usamos next aquí)
const fs = require("fs");
const path = require("path");
try {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
      }
    }
  }
} catch (_) { /* ignore */ }

const { Client } = require("pg");

(async () => {
  console.log("DATABASE_URL starts with:", (process.env.DATABASE_URL || "").slice(0, 40));
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  try {
    await c.connect();
    const r = await c.query("SELECT id, email, role, is_active, created_at FROM app_users ORDER BY created_at LIMIT 10");
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.error("ERR:", e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
})();
