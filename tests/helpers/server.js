// Test helper: the real STAYPIT server, with D1 emulated (see d1emu.js).
process.env.CLOUDFLARE_ACCOUNT_ID="test";process.env.CLOUDFLARE_D1_DATABASE_ID="test";process.env.CLOUDFLARE_API_TOKEN="test";
await import("./d1emu.js");
await import("../../src/server.js");
