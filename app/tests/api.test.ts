import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { generateKeyPair, SignJWT } from "jose";
import { createHandler, verifyFirebaseToken } from "../worker/index.ts";

const project = "mynotes-auth-af57d";
let mf: Miniflare;
let db: D1Database;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let tokens: Record<string, string>;
let handler: ReturnType<typeof createHandler>;
async function token(uid: string, overrides: Record<string, unknown> = {}, signingKey?: CryptoKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: uid + "@example.test", email_verified: true, auth_time: now - 1, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "ephemeral-test-key" }).setSubject(uid)
    .setIssuer("https://securetoken.google.com/" + project).setAudience(project).setIssuedAt(now - 1).setExpirationTime(now + 3600).sign(signingKey ?? keys.privateKey);
}
async function call(uid: string | null, path: string, method = "GET", body?: unknown) {
  const response = await handler(new Request("https://notes.test" + path, { method,
    headers: { ...(uid ? { Authorization: "Bearer " + tokens[uid] } : {}), "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), { DB: db } as Env);
  return { status: response.status, data: await response.json() as Record<string, any>, headers: response.headers };
}
async function create(uid: string, kind: string, body: object) {
  const result = await call(uid, "/api/" + kind, "POST", body); assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data[kind === "notebooks" ? "notebook" : kind === "sections" ? "section" : "page"];
}
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "test", modules: true, script: "export default {fetch(){return new Response('test')}}", compatibilityDate: "2026-10-06", d1Databases: ["DB"] }] }));
  db = await mf.getD1Database("DB", "test") as unknown as D1Database;
  const sql = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(statement => db.prepare(statement)));
  keys = await generateKeyPair("RS256"); tokens = { alice: await token("alice"), bob: await token("bob") };
  // Test keys are injected only into the test handler. The production default always uses Google's JWKS.
  handler = createHandler(request => verifyFirebaseToken(request, keys.publicKey));
  for (const uid of ["alice", "bob"]) assert.equal((await call(uid, "/api/users/sync", "POST")).status, 200);
});
after(async () => { await mf?.dispose(); });

test("health is public; every private route requires a valid verified Firebase-style token", async () => {
  assert.equal((await call(null, "/api/health")).status, 200);
  for (const path of ["/api/me", "/api/notebooks", "/api/sections", "/api/pages", "/api/trash", "/api/users/sync"]) {
    const result = await call(null, path, path === "/api/users/sync" ? "POST" : "GET"); assert.equal(result.status, 401); assert.equal(result.headers.get("cache-control"), "no-store");
  }
  const now = Math.floor(Date.now() / 1000);
  const invalid = [
    "garbage", await token("unverified", { email_verified: false }), await token("future", { auth_time: now + 500 }),
    await new SignJWT({ auth_time: now - 1, email_verified: true }).setProtectedHeader({ alg: "RS256" }).setSubject("missing-exp").setIssuer("https://securetoken.google.com/" + project).setAudience(project).setIssuedAt(now - 1).sign(keys.privateKey),
    await new SignJWT({ auth_time: now - 1, email_verified: true }).setProtectedHeader({ alg: "RS256" }).setSubject("expired").setIssuer("https://securetoken.google.com/" + project).setAudience(project).setIssuedAt(now - 100).setExpirationTime(now - 10).sign(keys.privateKey),
    await new SignJWT({ auth_time: now - 1, email_verified: true }).setProtectedHeader({ alg: "RS256" }).setSubject("wrong-audience").setIssuer("https://securetoken.google.com/" + project).setAudience("another-project").setIssuedAt(now - 1).setExpirationTime(now + 10).sign(keys.privateKey),
    await token("wrong-signature", {}, (await generateKeyPair("RS256")).privateKey),
  ];
  for (const value of invalid) {
    const response = await handler(new Request("https://notes.test/api/me", { headers: { Authorization: "Bearer " + value } }), { DB: db } as Env); assert.equal(response.status, 401);
  }
});

test("two accounts cannot list, read, rename, delete, restore or attach to one another's hierarchy", async () => {
  const notebook = await create("alice", "notebooks", { title: "Alice", user_id: "bob" });
  const section = await create("alice", "sections", { title: "Private", notebook_id: notebook.id });
  const page = await create("alice", "pages", { title: "Secret", section_id: section.id });
  const bobNotebook = await create("bob", "notebooks", { title: "Bob" });
  assert.ok(!(await call("bob", "/api/notebooks")).data.notebooks.some((row: any) => row.id === notebook.id));
  assert.ok(!(await call("alice", "/api/notebooks")).data.notebooks.some((row: any) => row.id === bobNotebook.id));
  assert.equal((await call("bob", "/api/sections?notebook_id=" + notebook.id)).status, 404);
  assert.equal((await call("bob", "/api/pages?section_id=" + section.id)).status, 404);
  for (const [kind, row] of [["notebooks", notebook], ["sections", section], ["pages", page]] as const) {
    for (const method of ["GET", "PATCH", "DELETE"]) assert.equal((await call("bob", "/api/" + kind + "/" + row.id, method, method === "PATCH" ? { title: "stolen", updated_at: row.updated_at } : undefined)).status, 404);
  }
  assert.equal((await call("bob", "/api/sections", "POST", { title: "Intruder", notebook_id: notebook.id })).status, 404);
  assert.equal((await call("bob", "/api/pages", "POST", { title: "Intruder", section_id: section.id })).status, 404);
  assert.equal((await call("alice", "/api/notebooks/" + notebook.id, "DELETE")).status, 200);
  assert.equal((await call("bob", "/api/notebooks/" + notebook.id + "/restore", "POST")).status, 404);
  assert.ok(!(await call("bob", "/api/trash")).data.items.some((row: any) => row.id === notebook.id));
  assert.equal((await call("alice", "/api/pages/" + page.id)).status, 404);
  assert.equal((await call("alice", "/api/notebooks/" + notebook.id + "/restore", "POST")).status, 200);
  assert.equal((await call("alice", "/api/pages/" + page.id)).status, 200);
});

test("CRUD persists, parent deletion hides descendants, and restore preserves content", async () => {
  const notebook = await create("alice", "notebooks", { title: "CRUD" });
  const section = await create("alice", "sections", { title: "Section", notebook_id: notebook.id });
  const page = await create("alice", "pages", { title: "Page", section_id: section.id });
  for (const [kind, row] of [["notebooks", notebook], ["sections", section]] as const) assert.equal((await call("alice", "/api/" + kind + "/" + row.id, "PATCH", { title: "Renamed " + kind })).status, 200);
  const content = JSON.stringify({ type: "mynotes-text", version: 1, text: "Olá 🌎\n☐ Testar persistência" });
  const save = await call("alice", "/api/pages/" + page.id, "PATCH", { title: "Saved", content_json: content, updated_at: page.updated_at }); assert.equal(save.status, 200);
  assert.equal((await call("alice", "/api/pages/" + page.id)).data.page.content_json, content);
  assert.equal((await call("alice", "/api/pages?section_id=" + section.id)).data.pages[0].title, "Saved");
  assert.equal((await call("alice", "/api/pages/" + page.id, "DELETE")).status, 200);
  assert.equal((await call("alice", "/api/pages/" + page.id)).status, 404);
  assert.equal((await call("alice", "/api/pages/" + page.id + "/restore", "POST")).data.page.content_json, content);
  assert.equal((await call("alice", "/api/sections/" + section.id, "DELETE")).status, 200);
  assert.equal((await call("alice", "/api/pages/" + page.id)).status, 404);
  assert.equal((await call("alice", "/api/pages", "POST", { title: "Hidden", section_id: section.id })).status, 404);
  assert.equal((await call("alice", "/api/sections/" + section.id + "/restore", "POST")).status, 200);
  assert.equal((await call("alice", "/api/pages/" + page.id)).data.page.content_json, content);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM pages WHERE id = ?").bind(page.id).first<any>()).count, 1);
});

test("stale and simultaneous saves cannot overwrite the winning page version", async () => {
  const notebook = await create("bob", "notebooks", { title: "Concurrency" });
  const section = await create("bob", "sections", { title: "Concurrency", notebook_id: notebook.id });
  const page = await create("bob", "pages", { title: "Before", section_id: section.id });
  const results = await Promise.all(["First", "Second"].map(title => call("bob", "/api/pages/" + page.id, "PATCH", { title, updated_at: page.updated_at })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200)!;
  assert.equal((await call("bob", "/api/pages/" + page.id)).data.page.title, winner.data.page.title);
  assert.equal((await call("bob", "/api/pages/" + page.id, "PATCH", { title: "No version" })).status, 409);
});

test("input validation, parameterized SQL, malformed JSON and body limits", async () => {
  for (const title of ["", "   ", "a".repeat(101), 5]) assert.equal((await call("alice", "/api/notebooks", "POST", { title })).status, 400);
  const safe = await create("alice", "notebooks", { title: "x'); DROP TABLE users; --" }); assert.equal((await call("alice", "/api/notebooks/" + safe.id)).status, 200);
  assert.equal((await call("alice", "/api/sections")).status, 400);
  const response = await handler(new Request("https://notes.test/api/notebooks", { method: "POST", headers: { Authorization: "Bearer " + tokens.alice }, body: "{broken" }), { DB: db } as Env); assert.equal(response.status, 400);
  assert.equal((await call("alice", "/api/notebooks", "POST", { title: "Large", padding: "x".repeat(256001) })).status, 413);
  assert.equal((await db.prepare("SELECT count(*) AS count FROM users").first<any>()).count, 2);
});

test("composite foreign keys prevent direct cross-account parent references", async () => {
  const notebook = await create("alice", "notebooks", { title: "FK boundary" });
  await assert.rejects(() => db.prepare("INSERT INTO sections (id, user_id, notebook_id, title) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), "bob", notebook.id, "Forbidden").run());
  const section = await create("alice", "sections", { title: "FK boundary", notebook_id: notebook.id });
  await assert.rejects(() => db.prepare("INSERT INTO pages (id, user_id, section_id, title) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), "bob", section.id, "Forbidden").run());
});

test("wrong issuer, future issue time, empty subject and oversized uid are rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  const jwt = (issuer: string, subject: string, iat: number) => new SignJWT({ auth_time: now - 1, email_verified: true })
    .setProtectedHeader({ alg: "RS256" }).setSubject(subject).setIssuer(issuer).setAudience(project).setIssuedAt(iat).setExpirationTime(now + 3600).sign(keys.privateKey);
  for (const value of [await jwt("https://attacker.test", "alice", now - 1), await jwt("https://securetoken.google.com/" + project, "alice", now + 100), await token(""), await token("x".repeat(129))]) {
    const response = await handler(new Request("https://notes.test/api/notebooks", { headers: { Authorization: "Bearer " + value } }), { DB: db } as Env); assert.equal(response.status, 401);
  }
});
