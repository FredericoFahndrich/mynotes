import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = "mynotes-auth-af57d";
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"));
type KeyResolver = Parameters<typeof jwtVerify>[1];
export type AuthenticatedUser = { uid: string; email: string | null; name: string | null };
type Kind = "notebooks" | "sections" | "pages";
type Row = { id: string; title: string; updated_at: string; content_json?: string; notebook_id?: string; section_id?: string };
const MAX_BODY = 256_000;

export async function verifyFirebaseToken(request: Request, keys: KeyResolver = GOOGLE_KEYS): Promise<AuthenticatedUser | null> {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: "https://securetoken.google.com/" + PROJECT_ID,
      audience: PROJECT_ID, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "auth_time"],
    });
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.sub !== "string" || !payload.sub.length || payload.sub.length > 128 ||
        typeof payload.iat !== "number" || payload.iat > now ||
        typeof payload.auth_time !== "number" || payload.auth_time > now || payload.email_verified !== true) return null;
    return { uid: payload.sub, email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null };
  } catch { return null; }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Corpo JSON obrigatório");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) { await reader.cancel(); throw new ApiError(413, "Anotação muito grande (limite de 256 KB)"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "JSON inválido");
  } finally { reader.releaseLock(); }
}
function titleOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new ApiError(400, "Título deve ter de 1 a 100 caracteres");
  return value.trim();
}
function idOf(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 128) throw new ApiError(400, "Identificador obrigatório");
  return value;
}
// Table names and joins are selected exclusively from this server-owned map.
const sources: Record<Kind, string> = {
  notebooks: "notebooks r",
  sections: "sections r JOIN notebooks n ON n.id = r.notebook_id AND n.user_id = r.user_id",
  pages: "pages r JOIN sections s ON s.id = r.section_id AND s.user_id = r.user_id JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = s.user_id",
};
const ancestors: Record<Kind, string> = {
  notebooks: "", sections: " AND n.deleted_at IS NULL", pages: " AND s.deleted_at IS NULL AND n.deleted_at IS NULL",
};
async function owned(db: D1Database, kind: Kind, uid: string, id: string, deleted = false): Promise<Row> {
  const row = await db.prepare("SELECT r.* FROM " + sources[kind] + " WHERE r.id = ? AND r.user_id = ? AND r.deleted_at IS " + (deleted ? "NOT NULL" : "NULL") + ancestors[kind]).bind(id, uid).first<Row>();
  if (!row) throw new ApiError(404, "Item não encontrado");
  return row;
}
const singular: Record<Kind, string> = { notebooks: "notebook", sections: "section", pages: "page" };
function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}

export function createHandler(authenticate: (request: Request) => Promise<AuthenticatedUser | null> = verifyFirebaseToken) {
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT 1 AS connected").first<{ connected: number }>();
        if (result?.connected !== 1) throw new ApiError(503, "Banco indisponível"); return json({ status: "ok", application: "Minhas Anotações", database: "connected" });
      }
      const user = await authenticate(request);
      if (!user) return json({ error: "Não autorizado" }, 401);
      if (url.pathname === "/api/me" && request.method === "GET") return json({ authenticated: true, uid: user.uid, email: user.email });
      if (url.pathname === "/api/users/sync" && request.method === "POST") {
        if (!user.email) throw new ApiError(400, "Conta sem e-mail");
        await env.DB.prepare("INSERT INTO users (id, email, display_name, email_verified) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, email_verified = 1, updated_at = CURRENT_TIMESTAMP").bind(user.uid, user.email, user.name).run();
        return json({ status: "ok", user: { id: user.uid, email: user.email } });
      }
      if (url.pathname === "/api/trash" && request.method === "GET") {
        const result = await env.DB.prepare("SELECT id, title, 'notebooks' AS kind, deleted_at FROM notebooks WHERE user_id = ? AND deleted_at IS NOT NULL UNION ALL SELECT id, title, 'sections' AS kind, deleted_at FROM sections WHERE user_id = ? AND deleted_at IS NOT NULL UNION ALL SELECT id, title, 'pages' AS kind, deleted_at FROM pages WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC").bind(user.uid, user.uid, user.uid).all();
        return json({ items: result.results });
      }
      const match = url.pathname.match(/^\/api\/(notebooks|sections|pages)(?:\/([^/]+)(?:\/(restore))?)?$/);
      if (!match) throw new ApiError(404, "Endpoint não encontrado");
      const kind = match[1] as Kind; const id = match[2]; const restore = match[3];
      if (!id && request.method === "GET") {
        let filter = ""; const params: string[] = [user.uid];
        if (kind !== "notebooks") {
          const parent = kind === "sections" ? "notebook_id" : "section_id";
          const parentId = idOf(url.searchParams.get(parent));
          await owned(env.DB, kind === "sections" ? "notebooks" : "sections", user.uid, parentId);
          filter = " AND r." + parent + " = ?"; params.push(parentId);
        }
        const result = await env.DB.prepare("SELECT r.* FROM " + sources[kind] + " WHERE r.user_id = ? AND r.deleted_at IS NULL" + ancestors[kind] + filter + " ORDER BY r.sort_order, r.created_at, r.id").bind(...params).all();
        // Ownership is enforced by the query; user_id need not leave the backend.
        const rows = result.results.map(({ user_id: _uid, ...row }) => row);
        return json({ [kind]: rows });
      }
      if (!id && request.method === "POST") {
        const body = await bodyOf(request); const title = titleOf(body.title);
        const newId = crypto.randomUUID(); const now = new Date().toISOString();
        if (kind === "notebooks") {
          const registered = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(user.uid).first();
          if (!registered) throw new ApiError(409, "Sincronize a conta antes de criar cadernos");
          await env.DB.prepare("INSERT INTO notebooks (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(newId, user.uid, title, now, now).run();
        } else {
          const parentField = kind === "sections" ? "notebook_id" : "section_id";
          const parentId = idOf(body[parentField]);
          await owned(env.DB, kind === "sections" ? "notebooks" : "sections", user.uid, parentId);
          const result = await env.DB.prepare("INSERT INTO " + kind + " (id, user_id, " + parentField + ", title, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM " + sources[kind === "sections" ? "notebooks" : "sections"] + " WHERE r.id = ? AND r.user_id = ? AND r.deleted_at IS NULL" + ancestors[kind === "sections" ? "notebooks" : "sections"] + ")").bind(newId, user.uid, parentId, title, now, now, parentId, user.uid).run();
          if (!result.meta.changes) throw new ApiError(404, "Destino não encontrado");
        }
        const row = await owned(env.DB, kind, user.uid, newId);
        return json({ [singular[kind]]: row }, 201);
      }
      if (!id) throw new ApiError(405, "Método não permitido");
      if (restore) {
        if (request.method !== "POST") throw new ApiError(405, "Método não permitido");
        const row = await owned(env.DB, kind, user.uid, id, true);
        await env.DB.prepare("UPDATE " + kind + " SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?").bind(nextTimestamp(row.updated_at), id, user.uid).run();
        return json({ [singular[kind]]: await owned(env.DB, kind, user.uid, id) });
      }
      const row = await owned(env.DB, kind, user.uid, id);
      if (request.method === "GET") return json({ [singular[kind]]: row });
      if (request.method === "PATCH") {
        const body = await bodyOf(request);
        const title = "title" in body ? titleOf(body.title) : row.title;
        if (kind === "pages" && body.updated_at !== row.updated_at) throw new ApiError(409, "A página mudou em outra janela. Recarregue para comparar antes de salvar.");
        let content = row.content_json;
        if ("content_json" in body) {
          if (kind !== "pages" || typeof body.content_json !== "string") throw new ApiError(400, "Conteúdo inválido");
          try {
            const parsed: unknown = JSON.parse(body.content_json);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
          } catch { throw new ApiError(400, "Conteúdo JSON inválido"); }
          content = body.content_json;
        }
        const updatedAt = nextTimestamp(row.updated_at);
        const statement = kind === "pages"
          ? env.DB.prepare("UPDATE pages SET title = ?, content_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ? AND deleted_at IS NULL").bind(title, content ?? "{}", updatedAt, id, user.uid, row.updated_at)
          : env.DB.prepare("UPDATE " + kind + " SET title = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ? AND deleted_at IS NULL").bind(title, updatedAt, id, user.uid, row.updated_at);
        const result = await statement.run();
        if (!result.meta.changes) throw new ApiError(409, "O item mudou. Recarregue e tente novamente.");
        return json({ [singular[kind]]: await owned(env.DB, kind, user.uid, id) });
      }
      if (request.method === "DELETE") {
        const now = nextTimestamp(row.updated_at);
        const result = await env.DB.prepare("UPDATE " + kind + " SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND updated_at = ? AND deleted_at IS NULL").bind(now, now, id, user.uid, row.updated_at).run();
        if (!result.meta.changes) throw new ApiError(409, "O item mudou. Recarregue e tente novamente.");
        return json({ status: "deleted", id, recoverable: true });
      }
      throw new ApiError(405, "Método não permitido");
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      // Do not log request bodies, credentials, user records or database errors.
      return json({ error: url.pathname === "/api/health" ? "Banco indisponível" : "Não foi possível concluir a operação. Tente novamente." }, url.pathname === "/api/health" ? 503 : 500);
    }
  };
}
export default { fetch: createHandler() } satisfies ExportedHandler<Env>;
