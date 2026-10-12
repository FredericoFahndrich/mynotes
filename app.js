
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  reload,
  signOut
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

// CONFIGURAÇÃO
const WORKER_URL = "https://SEU-WORKER.workers.dev";

const firebaseConfig = {
  apiKey: "AIzaSyAQn6YlOwkgHOLXs272-tcwMl1YP_SScwA",
  authDomain: "mynotes-auth-af57d.firebaseapp.com",
  projectId: "mynotes-auth-af57d",
  storageBucket: "mynotes-auth-af57d.firebasestorage.app",
  messagingSenderId: "214313205677",
  appId: "1:214313205677:web:69ae3d0eb37506cb492b24"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

const $ = id => document.getElementById(id);

const state = {
  notebooks: [],
  sections: [],
  pages: [],
  notebookId: null,
  sectionId: null,
  page: null,
  dirty: false,
  saving: null,
  session: 0
};

let authMode = "login";
let saveTimer = null;

// UTILIDADES
function message(text, error = false) {
  $("statusBar").textContent = text;
  $("statusBar").classList.toggle("error", error);
}

function authFeedback(text, error = false) {
  $("authMessage").textContent = text;
  $("authMessage").classList.toggle("error", error);
}

function show(view) {
  ["loginView", "verifyView", "appView"].forEach(id => {
    $(id).hidden = id !== view;
  });
}

function explain(error) {
  const code = error?.code;

  const known = {
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/email-already-in-use": "Este e-mail já está cadastrado.",
    "auth/weak-password": "Escolha uma senha mais forte.",
    "auth/popup-closed-by-user": "Login Google cancelado.",
    "auth/unauthorized-domain":
      "Autorize este domínio no Firebase Authentication.",
    "auth/too-many-requests":
      "Muitas tentativas. Aguarde antes de tentar novamente."
  };

  return known[code] || error?.message ||
    "Não foi possível concluir a operação.";
}

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem("mynotes-theme", theme);

  const symbol = theme === "dark" ? "☀" : "☾";
  $("themeButton").textContent = symbol;
  $("loginTheme").textContent = symbol;
}

function toggleTheme() {
  setTheme(
    document.body.dataset.theme === "dark" ? "light" : "dark"
  );
}

$("themeButton").onclick = toggleTheme;
$("loginTheme").onclick = toggleTheme;
setTheme(localStorage.getItem("mynotes-theme") || "light");

// API AUTENTICADA
async function api(path, method = "GET", body = undefined) {
  if (WORKER_URL.includes("SEU-WORKER")) {
    throw new Error(
      "Configure WORKER_URL no início do arquivo app.js."
    );
  }

  const user = auth.currentUser;

  if (!user) {
    throw new Error("Faça login para continuar.");
  }

  const token = await user.getIdToken();

  const response = await fetch(
    WORKER_URL.replace(/\/$/, "") + path,
    {
      method,
      cache: "no-store",
      headers: {
        "Authorization": `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json" })
      },
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) })
    }
  );

  if (auth.currentUser?.uid !== user.uid) {
    throw new Error("A sessão mudou. Entre novamente.");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

// LOGIN
function updateLoginMode() {
  const registering = authMode === "register";

  $("submitLogin").textContent =
    registering ? "Criar conta" : "Entrar";

  $("switchMode").textContent =
    registering ? "Já tenho uma conta" : "Criar conta";

  $("password").autocomplete =
    registering ? "new-password" : "current-password";
}

$("switchMode").onclick = () => {
  authMode = authMode === "login" ? "register" : "login";
  authFeedback("");
  updateLoginMode();
};

$("loginForm").onsubmit = async event => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;

  $("submitLogin").disabled = true;
  authFeedback("Aguarde...");

  try {
    if (authMode === "register") {
      const result = await createUserWithEmailAndPassword(
        auth, email, password
      );

      await sendEmailVerification(result.user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    authFeedback("");
  } catch (error) {
    authFeedback(explain(error), true);
  } finally {
    $("submitLogin").disabled = false;
  }
};

$("googleLogin").onclick = async () => {
  $("googleLogin").disabled = true;
  authFeedback("");

  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    authFeedback(explain(error), true);
  } finally {
    $("googleLogin").disabled = false;
  }
};

$("resetPassword").onclick = async () => {
  const email = $("email").value.trim();

  if (!email) {
    authFeedback("Informe primeiro o seu e-mail.", true);
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);

    authFeedback(
      "Se a conta estiver cadastrada, você receberá " +
      "instruções de recuperação."
    );
  } catch (error) {
    authFeedback(explain(error), true);
  }
};

$("checkVerification").onclick = async () => {
  const user = auth.currentUser;
  if (!user) return;

  try {
    await reload(user);
    await user.getIdToken(true);

    if (!user.emailVerified) {
      $("verifyMessage").textContent =
        "O endereço ainda não foi confirmado.";
      return;
    }

    await enterSession(user);
  } catch (error) {
    $("verifyMessage").textContent = explain(error);
  }
};

$("resendVerification").onclick = async () => {
  try {
    await sendEmailVerification(auth.currentUser);

    $("verifyMessage").textContent =
      "Mensagem de confirmação reenviada.";
  } catch (error) {
    $("verifyMessage").textContent = explain(error);
  }
};

$("verifyLogout").onclick = () => signOut(auth);

// CONVERSÃO DO CONTEÚDO
function decodeContent(content) {
  try {
    const doc = JSON.parse(content);

    if (
      doc.type === "mynotes-text" &&
      doc.version === 1 &&
      typeof doc.text === "string"
    ) {
      return { text: doc.text, editable: true };
    }

    if (
      doc.type === "doc" &&
      Array.isArray(doc.content) &&
      doc.content.length === 0
    ) {
      return { text: "", editable: true };
    }

    return {
      text: JSON.stringify(doc, null, 2),
      editable: false
    };
  } catch {
    return { text: String(content || ""), editable: false };
  }
}

function encodeContent(text) {
  return JSON.stringify({
    type: "mynotes-text",
    version: 1,
    text
  });
}

// ELEMENTOS DAS LISTAS
function emptyList(container, text) {
  container.replaceChildren();

  const paragraph = document.createElement("p");
  paragraph.className = "empty-list";
  paragraph.textContent = text;
  container.append(paragraph);
}

function renderItems(containerId, items, selectedId, kind) {
  const container = $(containerId);
  container.replaceChildren();

  if (!items.length) {
    emptyList(
      container,
      kind === "notebooks"
        ? "Crie seu primeiro caderno."
        : kind === "sections"
          ? "Nenhuma seção."
          : "Nenhuma anotação."
    );
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "item-row";

    if (item.id === selectedId) {
      row.classList.add("selected");
    }

    const select = document.createElement("button");
    select.className = "item-main";
    select.type = "button";
    select.title = item.title;

    const symbol = document.createElement("span");
    symbol.className = "item-symbol";
    symbol.textContent =
      kind === "notebooks" ? "▣" :
      kind === "sections" ? "◈" : "▤";

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.title;

    select.append(symbol, name);

    select.onclick = () => {
      if (kind === "notebooks") selectNotebook(item.id);
      if (kind === "sections") selectSection(item.id);
      if (kind === "pages") selectPage(item.id);
    };

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "✎";
    rename.title = "Renomear";
    rename.setAttribute("aria-label", `Renomear ${item.title}`);
    rename.onclick = () => action(kind, "rename", item);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Mover para a lixeira";
    remove.setAttribute("aria-label", `Excluir ${item.title}`);
    remove.onclick = () => action(kind, "delete", item);

    actions.append(rename, remove);
    row.append(select, actions);
    container.append(row);
  }
}

function renderNotebooks() {
  renderItems(
    "notebooksList",
    state.notebooks,
    state.notebookId,
    "notebooks"
  );
}

function renderSections() {
  renderItems(
    "sectionsList",
    state.sections,
    state.sectionId,
    "sections"
  );
}

function renderPages() {
  const search = $("searchInput").value.trim().toLowerCase();

  const results = state.pages.filter(page => {
    const content = decodeContent(page.content_json).text;
    return (page.title + " " + content)
      .toLowerCase().includes(search);
  });

  renderItems(
    "pagesList",
    results,
    state.page?.id,
    "pages"
  );
}

// EDITOR
function renderEditor() {
  const page = state.page;

  $("editorEmpty").hidden = Boolean(page);
  $("editorForm").hidden = !page;

  if (!page) return;

  const content = decodeContent(page.content_json);

  $("pageTitle").value = page.title;
  $("pageText").value = content.text;
  $("pageTitle").readOnly = !content.editable;
  $("pageText").readOnly = !content.editable;
  $("saveButton").disabled = !content.editable;

  state.dirty = false;

  const book = state.notebooks.find(
    item => item.id === state.notebookId
  );

  const section = state.sections.find(
    item => item.id === state.sectionId
  );

  $("breadcrumb").textContent =
    [book?.title, section?.title].filter(Boolean).join(" / ");

  $("saveState").textContent =
    content.editable ? "Salvo" : "Somente leitura";
}

function checkDirty() {
  if (!state.page) return;

  const original = decodeContent(state.page.content_json);

  if (!original.editable) return;

  state.dirty =
    $("pageTitle").value !== state.page.title ||
    $("pageText").value !== original.text;

  $("saveState").textContent =
    state.dirty ? "Alterações não salvas" : "Salvo";

  clearTimeout(saveTimer);

  if (state.dirty) {
    saveTimer = setTimeout(() => {
      void saveChanges();
    }, 1200);
  }
}

$("pageTitle").addEventListener("input", checkDirty);
$("pageText").addEventListener("input", checkDirty);

async function saveChanges() {
  clearTimeout(saveTimer);

  while (state.page && state.dirty) {
    if (state.saving) {
      try {
        await state.saving;
      } catch {
        return false;
      }
      continue;
    }

    const page = state.page;
    const title = $("pageTitle").value.trim();
    const text = $("pageText").value;

    if (!title || title.length > 100) {
      message("Informe um título de até 100 caracteres.", true);
      return false;
    }

    $("saveState").textContent = "Salvando...";

    state.saving = api(`/api/pages/${page.id}`, "PATCH", {
      title,
      content_json: encodeContent(text),
      updated_at: page.updated_at
    });

    try {
      const result = await state.saving;

      if (state.page?.id === page.id) {
        state.page = result.page;

        state.pages = state.pages.map(item =>
          item.id === result.page.id ? result.page : item
        );

        state.dirty =
          $("pageTitle").value !== result.page.title ||
          $("pageText").value !==
            decodeContent(result.page.content_json).text;

        renderPages();
      }

      $("saveState").textContent =
        state.dirty ? "Alterações não salvas" : "Salvo";

      message("Alterações salvas.");
    } catch (error) {
      $("saveState").textContent = "Erro ao salvar";

      message(
        explain(error) +
        " Seu texto permanece no editor. Não recarregue " +
        "a página antes de recuperá-lo.",
        true
      );

      return false;
    } finally {
      state.saving = null;
    }
  }

  return true;
}

$("saveButton").onclick = () => saveChanges();

$("downloadButton").onclick = () => {
  const title = $("pageTitle").value || "anotacao";
  const text = $("pageText").value;

  const blob = new Blob([title + "\n\n" + text], {
    type: "text/plain;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "anotacao.txt";
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

document.addEventListener("keydown", event => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s"
  ) {
    event.preventDefault();
    void saveChanges();
  }
});

window.addEventListener("beforeunload", event => {
  if (state.dirty || state.saving) {
    event.preventDefault();
  }
});

// CARREGAMENTO E NAVEGAÇÃO
async function loadNotebooks(preferred = null) {
  const data = await api("/api/notebooks");
  state.notebooks = data.notebooks;

  const next = state.notebooks.find(
    item => item.id === preferred
  )?.id || state.notebooks[0]?.id || null;

  await selectNotebook(next, true);
}

async function selectNotebook(id, skipSave = false) {
  if (!skipSave && !(await saveChanges())) return;

  state.notebookId = id;
  state.sectionId = null;
  state.page = null;
  state.sections = [];
  state.pages = [];

  renderNotebooks();
  renderSections();
  renderPages();
  renderEditor();

  if (!id) return;

  try {
    const data = await api(
      "/api/sections?notebook_id=" + encodeURIComponent(id)
    );

    if (state.notebookId !== id) return;

    state.sections = data.sections;
    renderSections();

    await selectSection(state.sections[0]?.id || null, true);
  } catch (error) {
    message(explain(error), true);
  }
}

async function selectSection(id, skipSave = false) {
  if (!skipSave && !(await saveChanges())) return;

  state.sectionId = id;
  state.page = null;
  state.pages = [];

  renderSections();
  renderPages();
  renderEditor();

  if (!id) return;

  try {
    const data = await api(
      "/api/pages?section_id=" + encodeURIComponent(id)
    );

    if (state.sectionId !== id) return;

    state.pages = data.pages;

    const first = state.pages[0] || null;
    state.page = first;

    renderPages();
    renderEditor();
  } catch (error) {
    message(explain(error), true);
  }
}

async function selectPage(id) {
  if (state.page?.id === id) return;

  if (!(await saveChanges())) return;

  state.page = state.pages.find(item => item.id === id) || null;

  renderPages();
  renderEditor();
}

async function refreshSections(preferred = null) {
  if (!state.notebookId) return;

  const data = await api(
    "/api/sections?notebook_id=" +
    encodeURIComponent(state.notebookId)
  );

  state.sections = data.sections;
  renderSections();

  const next = state.sections.find(
    item => item.id === preferred
  )?.id || state.sections[0]?.id || null;

  await selectSection(next, true);
}

async function refreshPages(preferred = null) {
  if (!state.sectionId) return;

  const data = await api(
    "/api/pages?section_id=" +
    encodeURIComponent(state.sectionId)
  );

  state.pages = data.pages;

  state.page = state.pages.find(
    item => item.id === preferred
  ) || state.pages[0] || null;

  renderPages();
  renderEditor();
}

// CRIAR, RENOMEAR E EXCLUIR
async function action(kind, operation, item = null) {
  if (!(await saveChanges())) return;

  let body = {};
  let method = "POST";
  let path = `/api/${kind}`;

  if (operation === "delete") {
    if (!confirm(`Mover "${item.title}" para a lixeira?`)) {
      return;
    }

    method = "DELETE";
    path += `/${item.id}`;
  } else {
    const title = prompt(
      operation === "create" ? "Nome do novo item:" : "Novo nome:",
      operation === "rename"
        ? item.title
        : kind === "pages" ? "Nova anotação" : ""
    )?.trim();

    if (title === undefined) return;

    if (!title || title.length > 100) {
      message("O título deve ter de 1 a 100 caracteres.", true);
      return;
    }

    body = { title };

    if (operation === "create") {
      if (kind === "sections") {
        if (!state.notebookId) return;
        body.notebook_id = state.notebookId;
      }

      if (kind === "pages") {
        if (!state.sectionId) return;
        body.section_id = state.sectionId;
      }
    } else {
      method = "PATCH";
      path += `/${item.id}`;

      if (kind === "pages") {
        const latest = state.pages.find(
          row => row.id === item.id
        );

        body.updated_at = latest?.updated_at || item.updated_at;
      }
    }
  }

  try {
    const data = await api(
      path,
      method,
      method === "DELETE" ? undefined : body
    );

    if (kind === "notebooks") {
      await loadNotebooks(
        operation === "create"
          ? data.notebook.id
          : state.notebookId
      );
    }

    if (kind === "sections") {
      await refreshSections(
        operation === "create"
          ? data.section.id
          : state.sectionId
      );
    }

    if (kind === "pages") {
      await refreshPages(
        operation === "create"
          ? data.page.id
          : state.page?.id
      );
    }

    message(
      operation === "create" ? "Item criado." :
      operation === "rename" ? "Nome atualizado." :
      "Item movido para a lixeira."
    );
  } catch (error) {
    message(explain(error), true);
  }
}

$("newNotebook").onclick = () => action("notebooks", "create");
$("newSection").onclick = () => action("sections", "create");
$("newPage").onclick = () => action("pages", "create");

$("searchInput").oninput = renderPages;

// LIXEIRA
async function loadTrash() {
  try {
    const data = await api("/api/trash");
    const list = $("trashList");

    list.replaceChildren();

    if (!data.items.length) {
      emptyList(list, "Sua lixeira está vazia.");
      return;
    }

    for (const item of data.items) {
      const row = document.createElement("div");
      row.className = "item-row";

      const name = document.createElement("span");
      name.className = "item-name";
      name.style.flex = "1";
      name.textContent = `${item.title} · ${item.kind}`;

      const restore = document.createElement("button");
      restore.className = "restore-button";
      restore.textContent = "Restaurar";

      restore.onclick = async () => {
        restore.disabled = true;

        try {
          if (!(await saveChanges())) return;

          await api(
            `/api/${item.kind}/${item.id}/restore`,
            "POST"
          );

          await loadNotebooks(state.notebookId);
          await loadTrash();

          message("Item restaurado.");
        } catch (error) {
          message(explain(error), true);
        } finally {
          restore.disabled = false;
        }
      };

      row.append(name, restore);
      list.append(row);
    }
  } catch (error) {
    message(explain(error), true);
  }
}

$("trashButton").onclick = async () => {
  await loadTrash();
  $("trashDialog").showModal();
};

$("closeTrash").onclick = () => $("trashDialog").close();

// SESSÃO FIREBASE
async function enterSession(user) {
  const currentSession = ++state.session;

  show("appView");
  $("accountEmail").textContent = user.email || "Usuário";

  message("Carregando suas anotações...");

  try {
    await api("/api/users/sync", "POST");

    if (currentSession !== state.session) return;

    await loadNotebooks();

    if (currentSession !== state.session) return;

    message("Conectado com segurança.");
  } catch (error) {
    if (currentSession !== state.session) return;
    message(explain(error), true);
  }
}

onAuthStateChanged(auth, async user => {
  ++state.session;

  clearTimeout(saveTimer);
  state.notebooks = [];
  state.sections = [];
  state.pages = [];
  state.notebookId = null;
  state.sectionId = null;
  state.page = null;
  state.dirty = false;
  state.saving = null;

  renderNotebooks();
  renderSections();
  renderPages();
  renderEditor();

  if (!user) {
    show("loginView");
    return;
  }

  await reload(user).catch(() => {});

  if (auth.currentUser?.uid !== user.uid) return;

  if (!user.emailVerified) {
    show("verifyView");
    return;
  }

  await enterSession(user);
});

$("logoutButton").onclick = async () => {
  if (!(await saveChanges())) {
    message(
      "Não foi possível salvar. Baixe o rascunho antes de sair.",
      true
    );
    return;
  }

  await signOut(auth);
};
