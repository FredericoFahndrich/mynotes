import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./firebase";
import { api, ApiError } from "./api";
import "./App.css";

type Kind = "notebooks" | "sections" | "pages";
type Item = { id: string; title: string; updated_at: string };
type Page = Item & { section_id: string; content_json: string };
type TrashItem = Item & { kind: Kind };
type Draft = { title: string; text: string };
type Action = { kind: Kind; mode: "create" | "rename" | "delete"; item?: Item };
const labels: Record<Kind, string> = { notebooks: "caderno", sections: "seção", pages: "página" };
function message(error: unknown) { return error instanceof Error ? error.message : "Não foi possível concluir a operação."; }
function readText(content: string): { text: string; editable: boolean } {
  try {
    const data = JSON.parse(content);
    if (data.type === "mynotes-text" && data.version === 1 && typeof data.text === "string") return { text: data.text, editable: true };
    if (data.type === "doc" && Array.isArray(data.content) && data.content.length === 0) return { text: "", editable: true };
    return { text: JSON.stringify(data, null, 2), editable: false };
  } catch { return { text: content, editable: false }; }
}
function encodeText(text: string) { return JSON.stringify({ type: "mynotes-text", version: 1, text }); }

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => localStorage.getItem("mynotes-theme") === "dark" ? "dark" : "light");
  const [notebooks, setNotebooks] = useState<Item[]>([]);
  const [sections, setSections] = useState<Item[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [notebookId, setNotebookId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", text: "" });
  const [loading, setLoading] = useState({ notebooks: true, sections: false, pages: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionError, setActionError] = useState("");
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [conflict, setConflict] = useState<Page | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null); const dialogRef = useRef<HTMLElement>(null);
  const lock = useRef(false);
  const dialogOpen = Boolean(action || trash);
  const loaded = page ? readText(page.content_json) : { text: "", editable: true };
  const dirty = Boolean(page && (draft.title !== page.title || draft.text !== loaded.text));

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current; if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
    controls()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !lock.current) { event.preventDefault(); setAction(null); setTrash(null); }
      if (event.key !== "Tab") return;
      const items = controls(); const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener("keydown", trap); return () => { dialog.removeEventListener("keydown", trap); previous?.focus(); };
  }, [dialogOpen]);
  function openPage(next: Page | null) {
    setPage(next); setDraft({ title: next?.title ?? "", text: next ? readText(next.content_json).text : "" }); setConflict(null);
  }
  function chooseNotebook(id: string | null) {
    setNotebookId(id); setSections([]); setSectionId(null); setPages([]); openPage(null);
    setLoading(previous => ({ ...previous, sections: Boolean(id), pages: false }));
  }
  function chooseSection(id: string | null) {
    setSectionId(id); setPages([]); openPage(null);
    setLoading(previous => ({ ...previous, pages: Boolean(id) }));
  }
  useEffect(() => { localStorage.setItem("mynotes-theme", theme); }, [theme]);
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        await api("/api/users/sync", { method: "POST", signal: controller.signal });
        const data = await api<{ notebooks: Item[] }>("/api/notebooks", { signal: controller.signal });
        if (!controller.signal.aborted) { setNotebooks(data.notebooks); chooseNotebook(data.notebooks[0]?.id ?? null); }
      } catch (caught) { if (!controller.signal.aborted) setError(message(caught)); }
      finally { if (!controller.signal.aborted) setLoading(previous => ({ ...previous, notebooks: false })); }
    })();
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    const controller = new AbortController();

    if (!notebookId) return () => controller.abort();

    void api<{ sections: Item[] }>("/api/sections?notebook_id=" + encodeURIComponent(notebookId), { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setSections(data.sections); chooseSection(data.sections[0]?.id ?? null); } })
      .catch(caught => { if (!controller.signal.aborted) setError(message(caught)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(previous => ({ ...previous, sections: false })); });
    return () => controller.abort();
  }, [notebookId]);
  useEffect(() => {
    const controller = new AbortController();
    if (!sectionId) return () => controller.abort();

    void api<{ pages: Page[] }>("/api/pages?section_id=" + encodeURIComponent(sectionId), { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setPages(data.pages); openPage(data.pages[0] ?? null); } })
      .catch(caught => { if (!controller.signal.aborted) setError(message(caught)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(previous => ({ ...previous, pages: false })); });
    return () => controller.abort();
  }, [sectionId]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function save(): Promise<boolean> {
    if (!page || !dirty) return true;
    if (lock.current || !loaded.editable) return false;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ page: Page }>("/api/pages/" + page.id, { method: "PATCH", body: JSON.stringify({ title: draft.title, content_json: encodeText(draft.text), updated_at: page.updated_at }) });
      setPages(previous => previous.map(item => item.id === result.page.id ? result.page : item));
      openPage(result.page); setNotice("Todas as alterações foram salvas."); return true;
    } catch (caught) {
      setError(message(caught));
      if (caught instanceof ApiError && caught.status === 409) {
        try { const current = await api<{ page: Page }>("/api/pages/" + page.id); setConflict(current.page); } catch { /* Keep the local draft intact. */ }
      }
      return false;
    } finally { lock.current = false; setBusy(false); }
  }
  async function move(change: () => void) {
    if (lock.current) return;
    if (await save()) { setError(""); setNotice(""); change(); }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  });
  function ask(kind: Kind, mode: Action["mode"], item?: Item) {
    setAction({ kind, mode, item }); setActionTitle(item?.title ?? (kind === "pages" ? "Nova anotação" : "")); setActionError("");
  }
  async function submitAction(event: FormEvent) {
    event.preventDefault(); if (!action || lock.current) return;
    if (!(await save())) { setActionError("Salve ou resolva as alterações da página antes de continuar."); return; }
    lock.current = true; setBusy(true); setActionError("");
    try {
      const { kind, mode, item } = action;
      if (mode === "delete" && item) {
        await api("/api/" + kind + "/" + item.id, { method: "DELETE" });
        if (kind === "notebooks") { const next = notebooks.filter(row => row.id !== item.id); setNotebooks(next); if (notebookId === item.id) chooseNotebook(next[0]?.id ?? null); }
        if (kind === "sections") { const next = sections.filter(row => row.id !== item.id); setSections(next); if (sectionId === item.id) chooseSection(next[0]?.id ?? null); }
        if (kind === "pages") { const next = pages.filter(row => row.id !== item.id); setPages(next); if (page?.id === item.id) openPage(next[0] ?? null); }
        setNotice("Item movido para a lixeira. Você pode restaurá-lo.");
      } else {
        const body: Record<string, unknown> = { title: actionTitle };
        if (mode === "create" && kind === "sections") body.notebook_id = notebookId;
        if (mode === "create" && kind === "pages") body.section_id = sectionId;
        if (mode === "rename" && kind === "pages" && item) body.updated_at = page?.id === item?.id ? (await api<{ page: Page }>("/api/pages/" + item.id)).page.updated_at : item?.updated_at;
        const result = await api<Record<string, Item | Page>>("/api/" + kind + (mode === "rename" ? "/" + item?.id : ""), { method: mode === "rename" ? "PATCH" : "POST", body: JSON.stringify(body) });
        const row = result[kind === "notebooks" ? "notebook" : kind === "sections" ? "section" : "page"]!;
        if (kind === "notebooks") { setNotebooks(previous => mode === "create" ? [...previous, row] : previous.map(old => old.id === row.id ? row : old)); if (mode === "create") chooseNotebook(row.id); }
        if (kind === "sections") { setSections(previous => mode === "create" ? [...previous, row] : previous.map(old => old.id === row.id ? row : old)); if (mode === "create") chooseSection(row.id); }
        if (kind === "pages") { setPages(previous => mode === "create" ? [...previous, row as Page] : previous.map(old => old.id === row.id ? row as Page : old)); if (mode === "create" || page?.id === row.id) openPage(row as Page); }
        setNotice(mode === "create" ? "Item criado e salvo." : "Nome atualizado.");
      }
      setAction(null); setError("");
    } catch (caught) { setActionError(message(caught)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function loadTrash() {
    if (!(await save())) return;
    setBusy(true);
    try { const data = await api<{ items: TrashItem[] }>("/api/trash"); setTrash(data.items); setError(""); } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  }
  async function restore(item: TrashItem) {
    if (lock.current) return; lock.current = true; setBusy(true);
    try {
      await api("/api/" + item.kind + "/" + item.id + "/restore", { method: "POST" });
      setTrash(previous => previous?.filter(row => row.id !== item.id) ?? null); setNotice("Item restaurado.");
      // Refresh children even if the currently selected parent did not change.
      if (item.kind === "notebooks") { const data = await api<{ notebooks: Item[] }>("/api/notebooks"); setNotebooks(data.notebooks); if (notebookId === null) chooseNotebook(item.id); }
      if (item.kind === "sections" && notebookId) { const data = await api<{ sections: Item[] }>("/api/sections?notebook_id=" + notebookId); setSections(data.sections); if (sectionId === null) chooseSection(data.sections[0]?.id ?? null); }
      if (item.kind === "pages" && sectionId) { const data = await api<{ pages: Page[] }>("/api/pages?section_id=" + sectionId); setPages(data.pages); if (!page) openPage(data.pages[0] ?? null); }
      setError("");
    } catch (caught) { setError(message(caught) + " Se o destino também estiver na lixeira, restaure-o primeiro."); }
    finally { lock.current = false; setBusy(false); }
  }
  function insertText(value: string) {
    const field = bodyRef.current; if (!field) return;
    const start = field.selectionStart; const end = field.selectionEnd;
    setDraft(previous => ({ ...previous, text: previous.text.slice(0, start) + value + previous.text.slice(end) })); field.focus();
  }
  function downloadDraft() {
    const link = document.createElement("a"); const url = URL.createObjectURL(new Blob([draft.title + "\n\n" + draft.text], { type: "text/plain;charset=utf-8" }));
    link.href = url; link.download = "anotacao.txt"; link.click(); URL.revokeObjectURL(url);
  }
  const visiblePages = pages.filter(row => (row.title + " " + readText(row.content_json).text).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const disabled = busy || loading.notebooks || loading.sections || loading.pages;
  function panel(kind: Kind, items: Item[], selected: string | null) {
    const heading = kind === "notebooks" ? "Cadernos" : kind === "sections" ? "Seções" : "Páginas";
    const canCreate = kind === "notebooks" || (kind === "sections" ? Boolean(notebookId) : Boolean(sectionId));
    return <aside className={"panel " + kind + "-panel"} aria-label={heading}>
      <div className="panel-title"><h3>{heading}</h3><button disabled={disabled || !canCreate} onClick={() => ask(kind, "create")} aria-label={"Criar " + labels[kind]}>+</button></div>
      {loading[kind] ? <p className="empty-state" role="status">Carregando...</p> : items.length === 0 ? <p className="empty-state">{canCreate ? "Crie seu primeiro item com +." : "Selecione o item da coluna anterior."}</p> : items.map(item => <div className="item-row" key={item.id}>
        <button className={(kind === "pages" ? "page-item" : "nav-item") + (selected === item.id ? " selected" : "")} disabled={busy} aria-pressed={selected === item.id} onClick={() => void move(() => kind === "notebooks" ? (item.id !== notebookId && chooseNotebook(item.id)) : kind === "sections" ? (item.id !== sectionId && chooseSection(item.id)) : openPage(item as Page))}>
          <span className={kind === "notebooks" ? "nav-dot" : kind === "sections" ? "section-indicator" : "page-icon"}>{kind === "pages" ? "▤" : ""}</span><span className="item-name">{item.title}</span>
        </button><div className="item-actions"><button disabled={disabled} aria-label={"Renomear " + labels[kind] + " " + item.title} onClick={() => ask(kind, "rename", item)}>✎</button><button disabled={disabled} aria-label={"Excluir " + labels[kind] + " " + item.title} onClick={() => ask(kind, "delete", item)}>×</button></div>
      </div>)}
    </aside>;
  }
  return <div className="notes-app" data-theme={theme}><div className="app-window">
    <header className="app-header"><div className="app-brand"><span className="app-logo">▣</span><strong>Minhas Anotações</strong></div>
      <input className="search-input" aria-label="Buscar nesta seção" placeholder="Buscar nesta seção..." value={search} onChange={event => setSearch(event.target.value)} />
      <div className="header-actions"><button className="theme-button" aria-label="Alternar tema" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "☾" : "☀"}</button>
        <button className="quiet-button" disabled={disabled} onClick={() => void loadTrash()}>Lixeira</button><span className="account-status">{auth.currentUser?.email}</span>
        <button className="logout-button" disabled={busy} onClick={() => void move(() => { void signOut(auth).catch(caught => setError(message(caught))); })}>Sair</button></div>
    </header>
    {(error || notice) && <div className={"status-banner " + (error ? "error" : "")}><span role={error ? "alert" : "status"}>{error || notice}</span>{error && <button disabled={disabled || dirty} onClick={() => { chooseNotebook(null); setLoading(previous => ({ ...previous, notebooks: true })); setError(""); setRetry(previous => previous + 1); }}>Tentar novamente</button>}</div>}
    <main className="workspace">{panel("notebooks", notebooks, notebookId)}{panel("sections", sections, sectionId)}{panel("pages", visiblePages, page?.id ?? null)}
      <section className="editor-panel" aria-label="Editor">
        {page ? <><div className="editor-toolbar"><span role="status">{busy ? "Salvando..." : dirty ? "Alterações não salvas" : "Salvo"}</span><button className="quiet-button" disabled={busy || !dirty || !loaded.editable} onClick={() => void save()}>Salvar</button><button className="quiet-button" onClick={downloadDraft}>Baixar texto</button></div>
          <div className="editor-content"><input aria-label="Título da página" className="note-title" maxLength={100} disabled={busy || !loaded.editable} value={draft.title} onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} />
            <div className="note-tags"><span>{notebooks.find(row => row.id === notebookId)?.title}</span><span>{sections.find(row => row.id === sectionId)?.title}</span></div>
            {!loaded.editable && <p role="status">Esta página usa outro formato. O conteúdo está disponível para leitura e download.</p>}
            <textarea ref={bodyRef} aria-label="Conteúdo da página" className="note-body" placeholder="Comece a escrever..." readOnly={!loaded.editable} disabled={busy} value={draft.text} onChange={event => setDraft(previous => ({ ...previous, text: event.target.value }))} />
            {loaded.editable && <div className="text-tools"><button disabled={busy} className="quiet-button" onClick={() => insertText("\n• ")}>Adicionar lista</button><button disabled={busy} className="quiet-button" onClick={() => insertText("\n☐ ")}>Adicionar tarefa</button><small>Ctrl/⌘ + S para salvar. Trocar de página também salva suas alterações.</small></div>}
            {conflict && <div className="conflict-card" role="alert"><strong>Há uma versão mais recente.</strong><p>Seu rascunho foi preservado. Baixe uma cópia antes de abrir a versão salva.</p><pre>{readText(conflict.content_json).text}</pre><button className="quiet-button" onClick={downloadDraft}>Baixar meu rascunho</button><button className="quiet-button" onClick={() => { openPage(conflict); setPages(previous => previous.map(row => row.id === conflict.id ? conflict : row)); setError(""); }}>Abrir versão salva</button></div>}
          </div></> : <div className="editor-empty"><span>▤</span><h2>Espaço para suas ideias</h2><p>{loading.pages ? "Carregando páginas..." : sectionId ? "Crie uma página para começar a escrever." : "Escolha ou crie um caderno e uma seção."}</p></div>}
      </section>
    </main>
    {action && <div className="modal-backdrop"><section ref={dialogRef} className="notes-dialog" role="dialog" aria-modal="true" aria-labelledby="action-heading"><form onSubmit={event => void submitAction(event)}>
      <h2 id="action-heading">{action.mode === "create" ? "Criar " : action.mode === "rename" ? "Renomear " : "Excluir "}{labels[action.kind]}</h2>
      {action.mode === "delete" ? <p>“{action.item?.title}” será movido para a lixeira.{action.kind !== "pages" && " Os itens dentro dele ficarão ocultos até a restauração."}</p> : <label>Nome<input autoFocus required maxLength={100} value={actionTitle} onChange={event => setActionTitle(event.target.value)} disabled={busy} /></label>}
      {actionError && <p role="alert" className="dialog-error">{actionError}</p>}<div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setAction(null)}>Cancelar</button><button type="submit" disabled={busy}>{busy ? "Aguarde..." : action.mode === "delete" ? "Mover para lixeira" : "Salvar"}</button></div>
    </form></section></div>}
    {trash && <div className="modal-backdrop"><section ref={dialogRef} className="notes-dialog" role="dialog" aria-modal="true" aria-labelledby="trash-heading"><h2 id="trash-heading">Lixeira</h2><p>Restaure o caderno antes de suas seções, e a seção antes de suas páginas.</p>{trash.length === 0 && <p>A lixeira está vazia.</p>}{trash.map(item => <div className="trash-row" key={item.id}><span>{item.title}<small>{labels[item.kind]}</small></span><button disabled={busy} onClick={() => void restore(item)}>Restaurar</button></div>)}{error && <p role="alert">{error}</p>}<div className="dialog-actions"><button disabled={busy} onClick={() => setTrash(null)}>Fechar</button></div></section></div>}
  </div></div>;
}
