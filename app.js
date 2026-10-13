import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, reload, signOut
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

const API_URL = "https://mynotes-backend.frederico-fahndrich.workers.dev";
const firebase = initializeApp({
  apiKey: "AIzaSyAQn6YlOwkgHOLXs272-tcwMl1YP_SScwA",
  authDomain: "mynotes-auth-af57d.firebaseapp.com",
  projectId: "mynotes-auth-af57d",
  storageBucket: "mynotes-auth-af57d.firebasestorage.app",
  messagingSenderId: "214313205677",
  appId: "1:214313205677:web:69ae3d0eb37506cb492b24"
});
const auth = getAuth(firebase);
const $ = id => document.getElementById(id);
const state = {
  uid: null, generation: 0, navigation: 0,
  notebooks: [], sections: [], pages: [],
  notebookId: null, sectionId: null, page: null,
  dirty: false, saving: null, busy: false, showGuideEditor: false
};
let registerMode = false;
let autosaveTimer = null;

function show(view) {
  for (const id of ["loginView", "verifyView", "appView"]) $(id).hidden = id !== view;
}
function status(text, error = false) {
  $("statusBar").textContent = text;
  $("statusBar").classList.toggle("error", error);
}
function authMessage(text) { $("authError").textContent = text; }
function errorText(error) {
  const codes = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "E-mail já cadastrado.",
    "auth/weak-password": "Escolha uma senha mais forte.",
    "auth/unauthorized-domain": "Autorize o domínio github.io no Firebase.",
    "auth/popup-closed-by-user": "Login Google cancelado.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos."
  };
  return codes[error?.code] || error?.message || "Operação não concluída.";
}
function current() { return Boolean(state.uid && auth.currentUser?.uid === state.uid); }
function theme(value) {
  document.body.dataset.theme = value;
  localStorage.setItem("mynotes-theme", value);
  $("themeToggle").textContent = value === "dark" ? "☀" : "☾";
}
theme(localStorage.getItem("mynotes-theme") === "dark" ? "dark" : "light");
$("themeToggle").onclick = () => theme(document.body.dataset.theme === "dark" ? "light" : "dark");

async function api(path, method = "GET", body) {
  const user = auth.currentUser;
  if (!user || !state.uid || user.uid !== state.uid) throw new Error("Sessão encerrada.");
  const token = await user.getIdToken();
  const response = await fetch(API_URL + path, {
    method, cache: "no-store",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!current()) throw new Error("A conta foi alterada. Entre novamente.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}

// Firebase: login, cadastro, verificação e recuperação de senha.
$("authForm").onsubmit = async event => {
  event.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  $("authSubmit").disabled = true;
  authMessage("Aguarde...");
  try {
    if (registerMode) {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(result.user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    authMessage("");
  } catch (error) { authMessage(errorText(error)); }
  finally { $("authSubmit").disabled = false; }
};
$("googleLogin").onclick = async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (error) { authMessage(errorText(error)); }
};
$("toggleRegister").onclick = () => {
  registerMode = !registerMode;
  $("authSubmit").textContent = registerMode ? "Criar conta" : "Entrar";
  $("toggleRegister").textContent = registerMode ? "Já tenho conta" : "Criar conta";
  $("loginSubtitle").textContent = registerMode
    ? "Crie sua conta para organizar suas ideias."
    : "Organize suas ideias com privacidade.";
  $("password").autocomplete = registerMode ? "new-password" : "current-password";
  $("password").value = "";
  $("password").type = "password";
  $("togglePasswordVisibility").setAttribute("aria-pressed", "false");
  $("togglePasswordVisibility").setAttribute("aria-label", "Mostrar senha");
  authMessage("");
};

// A exibição da senha é apenas visual; a autenticação Firebase não é alterada.
$("togglePasswordVisibility").onclick = () => {
  const field = $("password");
  const showPassword = field.type === "password";
  field.type = showPassword ? "text" : "password";
  $("togglePasswordVisibility").setAttribute("aria-pressed", String(showPassword));
  $("togglePasswordVisibility").setAttribute("aria-label", showPassword ? "Ocultar senha" : "Mostrar senha");
  field.focus({ preventScroll: true });
};
$("resetPassword").onclick = async () => {
  const email = $("email").value.trim();
  if (!email) return authMessage("Digite seu e-mail para recuperar a senha.");
  try {
    await sendPasswordResetEmail(auth, email);
    authMessage("Se a conta existir, você receberá instruções por e-mail.");
  } catch (error) { authMessage(errorText(error)); }
};
$("verifyAgain").onclick = async () => {
  try {
    const user = auth.currentUser;
    if (!user) return show("loginView");
    await reload(user);
    await user.getIdToken(true);
    if (!user.emailVerified) throw new Error("Seu e-mail ainda não foi confirmado.");
    await enter(user);
  } catch (error) { $("verifyMessage").textContent = errorText(error); }
};
$("verifyResend").onclick = async () => {
  try {
    if (!auth.currentUser) throw new Error("Faça login novamente.");
    await sendEmailVerification(auth.currentUser);
    $("verifyMessage").textContent = "Mensagem reenviada.";
  } catch (error) { $("verifyMessage").textContent = errorText(error); }
};
$("verifyExit").onclick = () => signOut(auth);

function decode(content) {
  try {
    const doc = JSON.parse(content || "{}");
    if (doc.type === "mynotes-text" && doc.version === 1 && typeof doc.text === "string") {
      return { text: doc.text, editable: true };
    }
    if (doc.type === "doc" && Array.isArray(doc.content) && doc.content.length === 0) {
      return { text: "", editable: true };
    }
    return { text: JSON.stringify(doc, null, 2), editable: false };
  } catch { return { text: String(content), editable: false }; }
}
const encode = text => JSON.stringify({ type: "mynotes-text", version: 1, text });
function date(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
function empty(container, label) {
  const p = document.createElement("p");
  p.className = "empty-message";
  p.textContent = label;
  container.replaceChildren(p);
}
function drawList(containerId, rows, chosen, kind) {
  const container = $(containerId);
  container.replaceChildren();
  if (!rows.length) {
    empty(container, kind === "notebooks" ? "Crie um caderno com +." :
      kind === "sections" ? "Selecione um caderno e crie uma seção." :
      "Selecione uma seção e crie sua primeira anotação.");
    return;
  }
  const icons = {
    notebooks: {
      "Pessoal": "🏠", "Pessoais": "🏠", "Trabalho": "💼",
      "Estudos": "📚", "Projetos": "💡", "Ideias": "⭐",
      "Referências": "📄"
    },
    sections: {
      "Primeiros passos": "📋", "Anotações rápidas": "⚡",
      "Tarefas": "✅", "Planejamento": "📅",
      "Reuniões": "🗓️", "Conteúdos": "📖",
      "Ideias": "💡", "Pessoal": "👤",
      "Saúde": "❤️", "Viagens": "✈️",
      "Rascunhos": "✏️", "Materiais": "📚"
    }
  };
  for (const row of rows) {
    const wrap = document.createElement("div");
    wrap.className = (kind === "pages" ? "page-item" : "list-item") +
      (row.id === chosen ? " active" : "");
    const button = document.createElement("button");
    button.className = "row-main";
    button.type = "button";
    const icon = document.createElement("span");
    icon.className = "item-icon";
    icon.textContent = kind === "pages"
      ? "▤"
      : (icons[kind][row.title] || "▣");
    const label = document.createElement("span");
    label.className = "row-name";
    label.textContent = row.title;
    button.append(icon, label);
    if (kind === "pages") {
      const caption = document.createElement("small");
      caption.textContent = date(row.updated_at);
      label.append(caption);
    }
    button.onclick = () => {
      if (kind === "notebooks") void selectNotebook(row.id);
      else if (kind === "sections") void selectSection(row.id);
      else void selectPage(row.id);
    };
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "item-menu action-menu";
    menu.textContent = "⋮";
    menu.title = "Renomear ou excluir";
    menu.setAttribute("aria-label", `Opções de ${row.title}`);
    menu.onclick = () => void itemMenu(kind, row);
    wrap.append(button, menu);
    container.append(wrap);
  }
}
function draw() {
  drawList("notebooksList", state.notebooks, state.notebookId, "notebooks");
  drawList("sectionsList", state.sections, state.sectionId, "sections");
  const search = $("searchInput").value.toLocaleLowerCase("pt-BR");
  drawList("pagesList", state.pages.filter(p =>
    (p.title + " " + decode(p.content_json).text).toLocaleLowerCase("pt-BR").includes(search)
  ), state.page?.id, "pages");
  $("newSection").disabled = !state.notebookId;
  $("newPage").disabled = !state.sectionId;
  $("saveButton").disabled = !state.page || !decode(state.page.content_json).editable;
  $("downloadButton").disabled = !state.page;
}
function drawEditor() {
  const page = state.page;
  const isDefaultGuide = Boolean(page &&
    page.title === "Bem-vindo ao Minhas Anotações" &&
    decode(page.content_json).text ===
      examples[0].sections[0].pages[0].text);
  const showGuide = !page || (isDefaultGuide && !state.showGuideEditor);
  $("welcomeView").hidden = !showGuide;
  $("editorView").hidden = showGuide;
  $("editWelcomeButton").hidden = !isDefaultGuide;
  if (!page) {
    $("breadcrumb").textContent = "Meu espaço pessoal";
    return;
  }
  const content = decode(page.content_json);
  $("pageTitle").value = page.title;
  $("pageText").value = content.text;
  $("pageTitle").readOnly = !content.editable;
  $("pageText").readOnly = !content.editable;
  $("saveState").textContent = content.editable ? "✓ Salvo" : "Somente leitura";
  $("updatedAt").textContent = "Atualizado: " + date(page.updated_at);
  $("breadcrumb").textContent = [
    state.notebooks.find(n => n.id === state.notebookId)?.title,
    state.sections.find(s => s.id === state.sectionId)?.title
  ].filter(Boolean).join(" / ");
  state.dirty = false;
}
// O guia visual é uma página verdadeira do D1, editável pelo usuário.
$("editWelcomeButton").onclick = () => {
  if (!state.page) return;
  state.showGuideEditor = true;
  drawEditor();
  $("pageText").focus();
};

function updateDirty() {
  if (!state.page || !decode(state.page.content_json).editable) return;
  const old = decode(state.page.content_json);
  state.dirty = $("pageTitle").value !== state.page.title || $("pageText").value !== old.text;
  $("saveState").textContent = state.dirty ? "● Não salvo" : "✓ Salvo";
  clearTimeout(autosaveTimer);
  if (state.dirty) autosaveTimer = setTimeout(() => void save(), 1300);
}
$("pageTitle").oninput = updateDirty;
$("pageText").oninput = updateDirty;

async function save() {
  clearTimeout(autosaveTimer);
  if (state.saving) {
    try { await state.saving; } catch { return false; }
    return state.dirty ? save() : true;
  }
  if (!state.dirty || !state.page) return true;
  const page = state.page;
  const title = $("pageTitle").value.trim();
  const text = $("pageText").value;
  if (!title || title.length > 100) {
    status("O título deve ter entre 1 e 100 caracteres.", true);
    return false;
  }
  $("saveState").textContent = "Salvando...";
  const task = api(`/api/pages/${encodeURIComponent(page.id)}`, "PATCH", {
    title, content_json: encode(text), updated_at: page.updated_at
  });
  state.saving = task;
  try {
    const data = await task;
    if (state.page?.id !== page.id) return false;
    state.page = data.page;
    state.pages = state.pages.map(p => p.id === data.page.id ? data.page : p);
    const saved = decode(data.page.content_json).text;
    state.dirty = $("pageTitle").value !== data.page.title || $("pageText").value !== saved;
    $("updatedAt").textContent = "Atualizado: " + date(data.page.updated_at);
    $("saveState").textContent = state.dirty ? "● Não salvo" : "✓ Salvo";
    draw();
    if (state.dirty) autosaveTimer = setTimeout(() => void save(), 700);
    else status("Anotação salva no D1.");
    return true;
  } catch (error) {
    $("saveState").textContent = "Erro ao salvar";
    status(errorText(error) + " Seu texto permanece na tela. Baixe-o antes de sair ou atualizar.", true);
    return false;
  } finally { if (state.saving === task) state.saving = null; }
}
$("saveButton").onclick = () => void save();
$("downloadButton").onclick = () => {
  if (!state.page) return;
  const blob = new Blob([$("pageTitle").value + "\n\n" + $("pageText").value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "anotacao.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void save();
  }
});
window.addEventListener("beforeunload", event => {
  if (state.dirty || state.saving) event.preventDefault();
});

async function loadNotebooks(preferred = null) {
  const response = await api("/api/notebooks");
  state.notebooks = response.notebooks;
  const id = state.notebooks.find(n => n.id === preferred)?.id || state.notebooks[0]?.id || null;
  await selectNotebook(id, true);
}
async function selectNotebook(id, skipSave = false) {
  if (!skipSave && !(await save())) return;
  const generation = state.generation;
  const nav = ++state.navigation;
  state.showGuideEditor = false;
  state.notebookId = id;
  state.sectionId = null;
  state.page = null;
  state.sections = [];
  state.pages = [];
  draw(); drawEditor();
  if (!id) return;
  try {
    const result = await api("/api/sections?notebook_id=" + encodeURIComponent(id));
    if (generation !== state.generation || nav !== state.navigation) return;
    state.sections = result.sections;
    draw();
    await selectSection(state.sections[0]?.id || null, true);
  } catch (error) { if (generation === state.generation) status(errorText(error), true); }
}
async function selectSection(id, skipSave = false) {
  if (!skipSave && !(await save())) return;
  const generation = state.generation;
  const nav = ++state.navigation;
  state.showGuideEditor = false;
  state.sectionId = id;
  state.page = null;
  state.pages = [];
  draw(); drawEditor();
  if (!id) return;
  try {
    const result = await api("/api/pages?section_id=" + encodeURIComponent(id));
    if (generation !== state.generation || nav !== state.navigation) return;
    state.pages = result.pages;
    state.page = state.pages[0] || null;
    draw(); drawEditor();
  } catch (error) { if (generation === state.generation) status(errorText(error), true); }
}
async function selectPage(id) {
  if (state.page?.id === id || !(await save())) return;
  state.showGuideEditor = false;
  state.page = state.pages.find(p => p.id === id) || null;
  draw(); drawEditor();
}
async function refreshSections(preferred) {
  const result = await api("/api/sections?notebook_id=" + encodeURIComponent(state.notebookId));
  state.sections = result.sections;
  await selectSection(state.sections.find(s => s.id === preferred)?.id || state.sections[0]?.id || null, true);
}
async function refreshPages(preferred) {
  const result = await api("/api/pages?section_id=" + encodeURIComponent(state.sectionId));
  state.pages = result.pages;
  state.showGuideEditor = false;
  state.page = state.pages.find(p => p.id === preferred) || state.pages[0] || null;
  draw(); drawEditor();
}

async function changeItem(kind, operation, row = null) {
  if (state.busy || !(await save())) return;
  let title = "";
  if (operation === "delete") {
    if (!confirm(`Mover "${row.title}" para a lixeira?`)) return;
  } else {
    const response = prompt(operation === "create" ? "Nome do novo item:" : "Novo nome:", row?.title || (kind === "pages" ? "Nova anotação" : ""));
    if (response === null) return;
    title = response.trim();
    if (title.length < 1 || title.length > 100) return status("Título inválido (1 a 100 caracteres).", true);
  }
  state.busy = true;
  try {
    let result;
    if (operation === "create") {
      const body = { title };
      if (kind === "sections") body.notebook_id = state.notebookId;
      if (kind === "pages") body.section_id = state.sectionId;
      result = await api("/api/" + kind, "POST", body);
    } else if (operation === "rename") {
      const body = { title };
      if (kind === "pages") body.updated_at = row.updated_at;
      result = await api("/api/" + kind + "/" + encodeURIComponent(row.id), "PATCH", body);
    } else {
      await api("/api/" + kind + "/" + encodeURIComponent(row.id), "DELETE");
    }
    if (kind === "notebooks") await loadNotebooks(operation === "create" ? result.notebook.id : state.notebookId);
    if (kind === "sections") await refreshSections(operation === "create" ? result.section.id : state.sectionId);
    if (kind === "pages") await refreshPages(operation === "create" ? result.page.id : state.page?.id);
    status(operation === "delete" ? "Movido para a lixeira." : "Alteração salva.");
  } catch (error) { status(errorText(error), true); }
  finally { state.busy = false; }
}
async function itemMenu(kind, row) {
  const option = prompt(`O que fazer com "${row.title}"?\nDigite R para renomear ou E para excluir.`, "R");
  if (!option) return;
  const letter = option.trim().toUpperCase();
  if (letter === "R") await changeItem(kind, "rename", row);
  else if (letter === "E") await changeItem(kind, "delete", row);
}
$("newNotebook").onclick = () => void changeItem("notebooks", "create");
$("newSection").onclick = () => void changeItem("sections", "create");
$("newPage").onclick = () => void changeItem("pages", "create");
$("searchInput").oninput = draw;

async function trash() {
  const dialog = $("trashDialog");
  const container = $("trashList");
  container.replaceChildren();
  try {
    const { items } = await api("/api/trash");
    if (!items.length) empty(container, "Sua lixeira está vazia.");
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "trash-row";
      const label = document.createElement("span");
      label.textContent = item.title + " · " + ({ notebooks: "Caderno", sections: "Seção", pages: "Anotação" }[item.kind] || item.kind);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Restaurar";
      button.onclick = async () => {
        if (!(await save())) return;
        button.disabled = true;
        try {
          await api(`/api/${item.kind}/${encodeURIComponent(item.id)}/restore`, "POST");
          await loadNotebooks(state.notebookId);
          await trash();
          status("Item restaurado.");
        } catch (error) { status(errorText(error) + " Restaure primeiro o caderno/seção pai, se também estiver excluído.", true); }
        finally { button.disabled = false; }
      };
      row.append(label, button);
      container.append(row);
    }
  } catch (error) { status(errorText(error), true); }
  if (!dialog.open) dialog.showModal();
}
$("openTrash").onclick = () => void trash();
$("closeTrash").onclick = () => $("trashDialog").close();

// Os exemplos são opcionais; nunca sobrescrevem uma página existente.
const examples = [
  {
    title: "Pessoal",
    sections: [
      {
        title: "Primeiros passos",
        pages: [
          {
            title: "Bem-vindo ao Minhas Anotações",
            text: "BEM-VINDO AO MINHAS ANOTAÇÕES\n\n" +
              "1. CADERNOS: agrupe seus assuntos pessoais e profissionais.\n" +
              "2. SEÇÕES: separe os temas de cada caderno.\n" +
              "3. ANOTAÇÕES: clique em + para criar uma página.\n" +
              "4. EDITOR: escreva e use Ctrl/⌘ + S para salvar.\n" +
              "5. LIXEIRA: restaure páginas, seções e cadernos removidos.\n\n" +
              "Experimente editar esta página e atualizar o navegador."
          },
          { title: "Como organizar minhas anotações",
            text: "Pessoal: anotações rápidas e tarefas.\n" +
              "Trabalho: reuniões e planejamento.\n" +
              "Estudos: conteúdos e revisões.\n" +
              "Projetos: ideias e acompanhamento." },
          { title: "Minha primeira nota",
            text: "Esta anotação foi criada como exemplo.\n\n" +
              "Você pode editar o texto, mudar seu título ou excluí-la." },
          { title: "Ideias para o futuro",
            text: "Registre projetos e ideias para desenvolver mais tarde.\n\n" +
              "Ideia 1:\nIdeia 2:\nIdeia 3:" },
          { title: "Lista de tarefas",
            text: "☐ Criar meu primeiro caderno\n" +
              "☐ Organizar minhas seções\n" +
              "☐ Testar o salvamento automático\n" +
              "☐ Revisar minhas prioridades" }
        ]
      },
      { title: "Anotações rápidas", pages: [
        { title: "Captura rápida", text: "Registre aqui um lembrete ou uma ideia.\n" }
      ] },
      { title: "Tarefas", pages: [
        { title: "Checklist semanal", text: "☐ Segunda-feira\n☐ Terça-feira\n☐ Quarta-feira" }
      ] },
      { title: "Pessoal", pages: [
        { title: "Metas pessoais", text: "Objetivos do mês:\n\nPróximos passos:" }
      ] },
      { title: "Saúde", pages: [
        { title: "Hábitos e bem-estar", text: "Hábitos que quero acompanhar:\n\nObservações:" }
      ] },
      { title: "Viagens", pages: [
        { title: "Planejamento de viagem", text: "Destino:\nDatas:\nOrçamento:\nItens necessários:" }
      ] }
    ]
  },
  { title: "Trabalho", sections: [
    { title: "Planejamento", pages: [
      { title: "Planejamento semanal", text: "Objetivos:\n\nPrioridades:\n\nPendências:" }
    ] },
    { title: "Reuniões", pages: [
      { title: "Modelo de reunião", text:
        "Data:\nParticipantes:\nPontos discutidos:\nDecisões:\nPróximos passos:" }
    ] }
  ] },
  { title: "Estudos", sections: [
    { title: "Conteúdos", pages: [
      { title: "Plano de estudos", text:
        "Assunto:\nObjetivo:\nReferências:\nPróxima revisão:" }
    ] }
  ] },
  { title: "Projetos", sections: [
    { title: "Ideias", pages: [
      { title: "Modelo de projeto", text:
        "Objetivo:\nRequisitos:\nAtividades:\nPrazos:" }
    ] }
  ] },
  { title: "Ideias", sections: [
    { title: "Rascunhos", pages: [
      { title: "Uma ideia para desenvolver", text:
        "Descrição da ideia:\n\nPossíveis aplicações:\n\nPróximos passos:" }
    ] }
  ] },
  { title: "Referências", sections: [
    { title: "Materiais", pages: [
      { title: "Referências úteis", text:
        "Livros:\n\nArtigos:\n\nLinks:\n\nObservações:" }
    ] }
  ] }
];

// Os exemplos são criados no D1, na conta autenticada.
// A operação reutiliza títulos já presentes, sem substituir seu conteúdo.
async function insertExampleData({ automatic = false } = {}) {
  if (state.busy || !(await save())) return false;
  state.busy = true;
  const uid = state.uid;

  try {
    status(automatic
      ? "Preparando seus cadernos de boas-vindas..."
      : "Inserindo exemplos no Cloudflare D1...");

    const { notebooks } = await api("/api/notebooks");
    let welcomeNotebookId = null;
    let welcomeSectionId = null;
    let welcomePageId = null;

    for (const template of examples) {
      if (state.uid !== uid || !current()) {
        throw new Error("A conta foi alterada durante a criação dos exemplos.");
      }

      let notebook = notebooks.find(n =>
        n.title === template.title ||
        (template.title === "Pessoal" && n.title === "Pessoais")
      );

      if (!notebook) {
        ({ notebook } = await api("/api/notebooks", "POST", {
          title: template.title
        }));
        notebooks.push(notebook);
      }

      if (template.title === "Pessoal") welcomeNotebookId = notebook.id;

      const { sections } = await api(
        "/api/sections?notebook_id=" + encodeURIComponent(notebook.id)
      );

      for (const group of template.sections) {
        let section = sections.find(s => s.title === group.title);
        if (!section) {
          ({ section } = await api("/api/sections", "POST", {
            title: group.title,
            notebook_id: notebook.id
          }));
          sections.push(section);
        }
        if (template.title === "Pessoal" && group.title === "Primeiros passos") {
          welcomeSectionId = section.id;
        }

        const { pages } = await api(
          "/api/pages?section_id=" + encodeURIComponent(section.id)
        );

        for (const sample of group.pages) {
          if (state.uid !== uid || !current()) {
            throw new Error("A conta foi alterada durante a criação dos exemplos.");
          }
          let page = pages.find(p => p.title === sample.title);
          if (!page) {
            ({ page } = await api("/api/pages", "POST", {
              title: sample.title,
              section_id: section.id
            }));

            const { page: saved } = await api(
              "/api/pages/" + encodeURIComponent(page.id),
              "PATCH",
              {
                title: sample.title,
                content_json: encode(sample.text),
                updated_at: page.updated_at
              }
            );
            page = saved;
            pages.push(page);
          }

          if (sample.title === "Bem-vindo ao Minhas Anotações") {
            welcomePageId = page.id;
          }
        }
      }
    }

    await loadNotebooks(welcomeNotebookId);
    if (welcomeSectionId) await selectSection(welcomeSectionId, true);
    if (welcomePageId) await selectPage(welcomePageId);

    status("Exemplos criados no D1. Sua página de boas-vindas está pronta.");
    return true;
  } catch (error) {
    status(errorText(error) +
      " Os itens criados foram preservados; tente entrar novamente para concluir.", true);
    return false;
  } finally {
    state.busy = false;
  }
}


async function enter(user) {
  const generation = ++state.generation;
  state.uid = user.uid;
  $("accountEmail").textContent = user.email || "Conta autenticada";
  show("appView");
  status("Carregando anotações...");
  try {
    await api("/api/users/sync", "POST");
    if (generation !== state.generation) return;
    await loadNotebooks();
    if (generation !== state.generation) return;

    // Configuração inicial: exemplos para contas novas e já existentes.
    // Os nomes existentes são reutilizados, sem sobrescrever notas.
    const onboardingKey = "mynotes-default-examples-v2:" + user.uid;
    if (!localStorage.getItem(onboardingKey)) {
      const initialized = await insertExampleData({ automatic: true });
      if (!initialized) return;
      if (generation !== state.generation || !current()) return;
      localStorage.setItem(onboardingKey, "completed");
    }
    if (generation === state.generation) {
      status("Conectado. Dados privados carregados do D1.");
    }
  } catch (error) { if (generation === state.generation) status(errorText(error), true); }
}
onAuthStateChanged(auth, async user => {
  ++state.generation;
  ++state.navigation;
  clearTimeout(autosaveTimer);
  state.uid = null;
  state.showGuideEditor = false;
  state.notebooks = [];
  state.sections = [];
  state.pages = [];
  state.notebookId = null;
  state.sectionId = null;
  state.page = null;
  state.dirty = false;
  state.saving = null;
  draw(); drawEditor();
  if (!user) return show("loginView");
  try { await reload(user); } catch { /* O token será verificado na API. */ }
  if (auth.currentUser?.uid !== user.uid) return;
  if (!user.emailVerified) return show("verifyView");
  await enter(user);
});
$("logoutButton").onclick = async () => {
  if (!(await save())) return status("Salve ou baixe o rascunho antes de sair.", true);
  try { await signOut(auth); } catch (error) { status(errorText(error), true); }
};

/* Integração da pesquisa com o aplicativo existente */

window.MyNotesBridge = Object.freeze({
  snapshot() {
    return {
      uid: state.uid,
      notebookId: state.notebookId,
      sectionId: state.sectionId,
      pages: state.pages.map(page => ({ ...page }))
    };
  },

  request(path) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/api/")
    ) {
      throw new Error("Rota de consulta inválida.");
    }

    return api(path);
  },

  async openPage({ notebookId, sectionId, pageId }) {
    if (!state.uid || !(await save())) {
      return false;
    }

    if (state.notebookId !== notebookId) {
      await selectNotebook(notebookId, true);
    }

    if (state.sectionId !== sectionId) {
      await selectSection(sectionId, true);
    }

    if (!state.pages.some(page => page.id === pageId)) {
      return false;
    }

    await selectPage(pageId);

    return state.page?.id === pageId;
  }
});

window.MyNotesTransferAdapter = Object.freeze({
  snapshot() {
    return {
      uid: state.uid,
      notebookId: state.notebookId,
      sectionId: state.sectionId,
      pageId: state.page?.id ?? null,
      pages: state.pages.map(page => ({ ...page }))
    };
  },

  saveCurrent() {
    return save();
  },

  request(path, method = "GET", body) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/api/") ||
      !["GET", "POST", "PATCH", "DELETE"].includes(method)
    ) {
      throw new Error("Requisição de transferência inválida.");
    }
    return api(path, method, body);
  },

  async openPage({ notebookId, sectionId, pageId }) {
    if (!state.uid || !(await save())) return false;

    if (state.notebookId !== notebookId) {
      await selectNotebook(notebookId, true);
    }
    if (state.sectionId !== sectionId) {
      await selectSection(sectionId, true);
    }
    // Inclui cópias recém-criadas, mesmo se o destino for a seção atual.
    if (!state.pages.some(page => page.id === pageId)) {
      await refreshPages(pageId);
    }
    if (!state.pages.some(page => page.id === pageId)) return false;

    await selectPage(pageId);
    return state.page?.id === pageId;
  }
});

// Acrescenta Mover e Copiar ao menu de três pontos das páginas.
// Os menus de cadernos e seções continuam funcionando como antes.
const originalItemMenuTransfer = itemMenu;
itemMenu = async function (kind, row) {
  if (kind !== "pages") {
    return originalItemMenuTransfer(kind, row);
  }

  const selected = prompt(
    `O que deseja fazer com "${row.title}"?\n` +
    "R = Renomear   E = Excluir\n" +
    "M = Mover         C = Copiar",
    "M"
  );
  if (selected === null) return;

  const action = selected.trim().toUpperCase();
  if (action === "R") return changeItem(kind, "rename", row);
  if (action === "E") return changeItem(kind, "delete", row);
  if (action === "M" || action === "C") {
    if (!window.MyNotesTransfer?.open) {
      return status("Módulo de transferência não carregado.", true);
    }
    return window.MyNotesTransfer.open({
      pageId: row.id,
      title: row.title,
      mode: action === "M" ? "move" : "copy"
    });
  }
};


