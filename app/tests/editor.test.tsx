import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { request, signOut } = vi.hoisted(() => ({ request: vi.fn(), signOut: vi.fn() }));
vi.mock("../src/firebase", () => ({ auth: { currentUser: { uid: "alice", email: "alice@example.test" } } }));
vi.mock("firebase/auth", () => ({ signOut }));
vi.mock("../src/api", () => ({
  api: request,
  ApiError: class extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } },
}));
import App from "../src/App";
import { ApiError } from "../src/api";

const initialPage = { id: "p1", section_id: "s1", title: "Minha página", updated_at: "v1", content_json: JSON.stringify({ type: "mynotes-text", version: 1, text: "Texto original" }) };
let stored = { ...initialPage };
let deleted = false;
let offline = false;

beforeEach(() => {
  localStorage.clear(); deleted = false; offline = false; stored = { ...initialPage };
  request.mockReset(); signOut.mockReset();
  request.mockImplementation(async (path: string, options: RequestInit = {}) => {
    if (path === "/api/users/sync") return {};
    if (path === "/api/notebooks") return { notebooks: [{ id: "n1", title: "Caderno", updated_at: "v1" }] };
    if (path.startsWith("/api/sections?")) return { sections: [{ id: "s1", title: "Seção", updated_at: "v1" }] };
    if (path.startsWith("/api/pages?")) return { pages: deleted ? [] : [{ ...stored }] };
    if (path === "/api/trash") return { items: deleted ? [{ id: "p1", title: stored.title, kind: "pages" }] : [] };
    if (path === "/api/pages/p1/restore") { deleted = false; stored = { ...stored, updated_at: "restored" }; return { page: { ...stored } }; }
    if (path === "/api/pages/p1") {
      if (deleted) throw new ApiError(404, "Item não encontrado");
      if (options.method === "PATCH") {
        if (offline) throw new TypeError("Falha de rede");
        const body = JSON.parse(options.body as string);
        if (body.updated_at !== stored.updated_at) throw new ApiError(409, "A página mudou em outra janela.");
        stored = { ...stored, ...body, updated_at: stored.updated_at + "-next" };
      }
      return { page: { ...stored } };
    }
    throw new Error("Unexpected test request: " + path);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function edit() {
  const user = userEvent.setup(); render(<App />);
  const body = await screen.findByRole("textbox", { name: "Conteúdo da página" });
  await user.clear(body); await user.type(body, "Rascunho novo");
  return { user, body };
}

test("clicking the selected page saves without reopening its stale content or version", async () => {
  const { user, body } = await edit();
  await user.click(screen.getByRole("button", { name: /Minha página/, pressed: true }));
  await waitFor(() => expect(JSON.parse(stored.content_json).text).toBe("Rascunho novo"));
  expect((body as HTMLTextAreaElement).value).toBe("Rascunho novo");
  await user.type(body, " adicional");
  await user.click(screen.getByRole("button", { name: "Salvar", exact: true }));
  await waitFor(() => expect(JSON.parse(stored.content_json).text).toBe("Rascunho novo adicional"));
  expect(screen.queryByText("Há uma versão mais recente.")).toBeNull();
});

test("a deleted page keeps its draft, allows trash restoration, and retains conflict protection", async () => {
  const { user, body } = await edit(); deleted = true;
  await user.click(screen.getByRole("button", { name: "Salvar", exact: true }));
  await screen.findByText("Página indisponível.");
  expect((body as HTMLTextAreaElement).value).toBe("Rascunho novo");
  await user.click(screen.getByRole("button", { name: "Lixeira", exact: true }));
  await screen.findByRole("dialog", { name: "Lixeira" });
  await user.click(screen.getByRole("button", { name: "Restaurar", exact: true }));
  await waitFor(() => expect(deleted).toBe(false));
  await user.click(screen.getByRole("button", { name: "Fechar", exact: true }));
  await user.click(screen.getByRole("button", { name: "Salvar", exact: true }));
  await screen.findByText("Há uma versão mais recente.");
  expect((body as HTMLTextAreaElement).value).toBe("Rascunho novo");
  expect(JSON.parse(stored.content_json).text).toBe("Texto original");
});

test("opening trash after a network error preserves pending edits", async () => {
  const { user, body } = await edit(); offline = true;
  await user.click(screen.getByRole("button", { name: "Salvar", exact: true }));
  await screen.findByText("Falha de rede");
  const saves = request.mock.calls.filter(([, options]) => options?.method === "PATCH").length;
  await user.click(screen.getByRole("button", { name: "Lixeira", exact: true }));
  await screen.findByRole("dialog", { name: "Lixeira" });
  expect((body as HTMLTextAreaElement).value).toBe("Rascunho novo");
  expect(request.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(saves);
});

test("discarding an unavailable draft requires confirmation before reloading the hierarchy", async () => {
  const { user, body } = await edit(); deleted = true;
  await user.click(screen.getByRole("button", { name: "Salvar", exact: true }));
  await screen.findByText("Página indisponível.");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await user.click(screen.getByRole("button", { name: "Descartar rascunho e recarregar" }));
  expect(confirm).toHaveBeenCalledOnce();
  expect((body as HTMLTextAreaElement).value).toBe("Rascunho novo");
  confirm.mockReturnValue(true);
  await act(async () => { await user.click(screen.getByRole("button", { name: "Descartar rascunho e recarregar" })); });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Conteúdo da página" })).toBeNull());
  expect(screen.queryByText("Página indisponível.")).toBeNull();
});
