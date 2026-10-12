
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
  uid: null,
  generation: 0,
  navigation: 0,
  notebooks: [],
  sections: [],
  pages: [],
  notebookId: null,
  sectionId: null,
  page: null,
  dirty: false,
  saving: null,
  busy: false
};

let registerMode = false;
let autosaveTimer = null;

// ================================================
// INTERFACE E UTILIDADES
// ================================================

function show(view) {
  for (const id of ["loginView", "verifyView", "appView"]) {
    $(id).hidden = id !== view;
  }
}

function status(text, error = false) {
  $("statusBar").textContent = text;
  $("statusBar").classList.toggle("error", error);
}

function authMessage(text) {
  $("authError").textContent = text;
}

function errorText(error) {
  const codes = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/email-already-in-use": "E-mail já cadastrado.",
    "auth/weak-password": "Escolha uma senha mais forte.",
    "auth/unauthorized-domain": "Autorize o domínio github.io no Firebase.",
    "auth/popup-closed-by-user": "Login Google cancelado.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos."
  };

  return codes[error?.code] ||
    error?.message ||
    "Operação não concluída.";
}

function current() {
  return Boolean(
    state.uid &&
    auth.currentUser?.uid === state.uid
  );
}

// ================================================
// TEMA CLARO / ESCURO
// ================================================

function theme(value) {
  document.body.dataset.theme = value;

  localStorage.setItem("mynotes-theme", value);

  $("themeToggle").textContent =
    value === "dark" ? "☀" : "☾";
}

theme(
  localStorage.getItem("mynotes-theme") === "dark"
    ? "dark"
    : "light"
);

$("themeToggle").onclick = () => {
  theme(
    document.body.dataset.theme === "dark"
      ? "light"
      : "dark"
  );
};

// ================================================
// API CLOUDFLARE
// ================================================

async function api(path, method = "GET", body) {
  const user = auth.currentUser;

  if (!user || !state.uid || user.uid !== state.uid) {
    throw new Error("Sessão encerrada.");
  }

  const token = await user.getIdToken();

  const response = await fetch(API_URL + path, {
    method,
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" })
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) })
  });

  if (!current()) {
    throw new Error(
      "A conta foi alterada. Entre novamente."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Erro HTTP ${response.status}`
    );
  }

  return data;
}

// ================================================
// FIREBASE — LOGIN E CADASTRO
// ================================================

$("authForm").onsubmit = async event => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;

  $("authSubmit").disabled = true;
  authMessage("Aguarde...");

  try {
    if (registerMode) {
      const result =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

      await sendEmailVerification(result.user);
    } else {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
    }

    authMessage("");
  } catch (error) {
    authMessage(errorText(error));
  } finally {
    $("authSubmit").disabled = false;
  }
};

// LOGIN GOOGLE
$("googleLogin").onclick = async () => {
  try {
    await signInWithPopup(
      auth,
      new GoogleAuthProvider()
    );
  } catch (error) {
    authMessage(errorText(error));
  }
};

// ALTERNAR CADASTRO / LOGIN
$("toggleRegister").onclick = () => {
  registerMode = !registerMode;

  $("authSubmit").textContent =
    registerMode ? "Criar conta" : "Entrar";

  $("toggleRegister").textContent =
    registerMode
      ? "Já tenho conta"
      : "Criar uma conta";

  $("password").autocomplete =
    registerMode
      ? "new-password"
      : "current-password";

  authMessage("");
};

// RECUPERAR SENHA
$("resetPassword").onclick = async () => {
  const email = $("email").value.trim();

  if (!email) {
    return authMessage(
      "Digite seu e-mail para recuperar a senha."
    );
  }

  try {
    await sendPasswordResetEmail(auth, email);

    authMessage(
      "Se a conta existir, você receberá " +
      "instruções por e-mail."
    );
  } catch (error) {
    authMessage(errorText(error));
  }
};

// CONFIRMAR E-MAIL
$("verifyAgain").onclick = async () => {
  try {
    const user = auth.currentUser;

    if (!user) {
      return show("loginView");
    }

    await reload(user);
    await user.getIdToken(true);

    if (!user.emailVerified) {
      throw new Error(
        "Seu e-mail ainda não foi confirmado."
      );
    }

    await enter(user);
  } catch (error) {
    $("verifyMessage").textContent =
      errorText(error);
  }
};

// REENVIAR CONFIRMAÇÃO
$("verifyResend").onclick = async () => {
  try {
    if (!auth.currentUser) {
      throw new Error("Faça login novamente.");
    }

    await sendEmailVerification(
      auth.currentUser
    );

    $("verifyMessage").textContent =
      "Mensagem reenviada.";
  } catch (error) {
    $("verifyMessage").textContent =
      errorText(error);
  }
};

$("verifyExit").onclick = () => signOut(auth);

// ================================================
// CONTEÚDO DAS ANOTAÇÕES
// ================================================

function decode(content) {
  try {
    const doc = JSON.parse(content || "{}");

    if (
      doc.type === "mynotes-text" &&
      doc.version === 1 &&
      typeof doc.text === "string"
    ) {
      return {
        text: doc.text,
        editable: true
      };
    }

    if (
      doc.type === "doc" &&
      Array.isArray(doc.content) &&
      doc.content.length === 0
    ) {
      return {
        text: "",
        editable: true
      };
    }

    return {
      text: JSON.stringify(doc, null, 2),
      editable: false
    };
  } catch {
    return {
      text: String(content),
      editable: false
    };
  }
}

const encode = text => JSON.stringify({
  type: "mynotes-text",
  version: 1,
  text
});

function date(value) {
  const d = new Date(value);

  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      });
}

// ================================================
// LISTAS — CADERNOS, SEÇÕES, ANOTAÇÕES
// ================================================

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
    empty(
      container,
      kind === "notebooks"
        ? "Crie um caderno com +."
        : kind === "sections"
          ? "Selecione um caderno e crie uma seção."
          : "Selecione uma seção e crie sua primeira anotação."
    );

    return;
  }

  const icons = {
    notebooks: "▣",
    sections: "◈",
    pages: "▤"
  };

  for (const row of rows) {
    const wrap = document.createElement("div");

    wrap.className =
      (kind === "pages" ? "page-item" : "list-item") +
      (row.id === chosen ? " active" : "");

    const button = document.createElement("button");

    button.className = "row-main";
    button.type = "button";

    const icon = document.createElement("span");
    icon.className = "item-icon";
    icon.textContent = icons[kind];

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
      if (kind === "notebooks") {
        void selectNotebook(row.id);
      } else if (kind === "sections") {
        void selectSection(row.id);
      } else {
        void selectPage(row.id);
      }
    };

    const menu = document.createElement("button");

    menu.type = "button";
    menu.className = "item-menu action-menu";
    menu.textContent = "⋮";
    menu.title = "Renomear ou excluir";

    menu.setAttribute(
      "aria-label",
      `Opções de ${row.title}`
    );

    menu.onclick = () => void itemMenu(kind, row);

    wrap.append(button, menu);
    container.append(wrap);
  }
}

function draw() {
  drawList(
    "notebooksList",
    state.notebooks,
    state.notebookId,
    "notebooks"
  );

  drawList(
    "sectionsList",
    state.sections,
    state.sectionId,
    "sections"
  );

  const search = $("searchInput")
    .value.toLocaleLowerCase("pt-BR");

  const results = state.pages.filter(p =>
    (
      p.title + " " +
      decode(p.content_json).text
    )
      .toLocaleLowerCase("pt-BR")
      .includes(search)
  );

  drawList(
    "pagesList",
    results,
    state.page?.id,
    "pages"
  );

  $("newSection").disabled = !state.notebookId;
  $("newPage").disabled = !state.sectionId;

  $("saveButton").disabled =
    !state.page ||
    !decode(state.page.content_json).editable;

  $("downloadButton").disabled = !state.page;
}

// ================================================
// EDITOR
// ================================================

function drawEditor() {
  const page = state.page;

  $("welcomeView").hidden = Boolean(page);
  $("editorView").hidden = !page;

  if (!page) {
    $("breadcrumb").textContent =
      "Meu espaço pessoal";
    return;
  }

  const content = decode(page.content_json);

  $("pageTitle").value = page.title;
  $("pageText").value = content.text;

  $("pageTitle").readOnly = !content.editable;
  $("pageText").readOnly = !content.editable;

  $("saveState").textContent =
    content.editable ? "✓ Salvo" : "Somente leitura";

  $("updatedAt").textContent =
    "Atualizado: " + date(page.updated_at);

  $("breadcrumb").textContent = [
    state.notebooks.find(
      n => n.id === state.notebookId
    )?.title,

    state.sections.find(
      s => s.id === state.sectionId
    )?.title
  ]
    .filter(Boolean)
    .join(" / ");

  state.dirty = false;
}

// DETECTAR MODIFICAÇÕES
function updateDirty() {
  if (
    !state.page ||
    !decode(state.page.content_json).editable
  ) {
    return;
  }

  const old = decode(state.page.content_json);

  state.dirty =
    $("pageTitle").value !== state.page.title ||
    $("pageText").value !== old.text;

  $("saveState").textContent =
    state.dirty ? "● Não salvo" : "✓ Salvo";

  clearTimeout(autosaveTimer);

  if (state.dirty) {
    autosaveTimer = setTimeout(
      () => void save(),
      1300
    );
  }
}

$("pageTitle").oninput = updateDirty;
$("pageText").oninput = updateDirty;

// SALVAMENTO NO D1
async function save() {
  clearTimeout(autosaveTimer);

  if (state.saving) {
    try {
      await state.saving;
    } catch {
      return false;
    }

    return state.dirty ? save() : true;
  }

  if (!state.dirty || !state.page) {
    return true;
  }

  const page = state.page;
  const title = $("pageTitle").value.trim();
  const text = $("pageText").value;

  if (!title || title.length > 100) {
    status(
      "O título deve ter entre 1 e 100 caracteres.",
      true
    );

    return false;
  }

  $("saveState").textContent = "Salvando...";

  const task = api(
    `/api/pages/${encodeURIComponent(page.id)}`,
    "PATCH",
    {
      title,
      content_json: encode(text),
      updated_at: page.updated_at
    }
  );

  state.saving = task;

  try {
    const data = await task;

    if (state.page?.id !== page.id) {
      return false;
    }

    state.page = data.page;

    state.pages = state.pages.map(p =>
      p.id === data.page.id ? data.page : p
    );

    const saved =
      decode(data.page.content_json).text;

    state.dirty =
      $("pageTitle").value !== data.page.title ||
      $("pageText").value !== saved;

    $("updatedAt").textContent =
      "Atualizado: " + date(data.page.updated_at);

    $("saveState").textContent =
      state.dirty ? "● Não salvo" : "✓ Salvo";

    draw();

    if (state.dirty) {
      autosaveTimer = setTimeout(
        () => void save(),
        700
      );
    } else {
      status("Anotação salva no D1.");
    }

    return true;
  } catch (error) {
    $("saveState").textContent = "Erro ao salvar";

    status(
      errorText(error) +
      " Seu texto permanece na tela. " +
      "Baixe-o antes de sair ou atualizar.",
      true
    );

    return false;
  } finally {
    if (state.saving === task) {
      state.saving = null;
    }
  }
}

// BOTÃO SALVAR
$("saveButton").onclick = () => void save();

// DOWNLOAD DA ANOTAÇÃO
$("downloadButton").onclick = () => {
  if (!state.page) return;

  const blob = new Blob(
    [
      $("pageTitle").value +
      "\n\n" +
      $("pageText").value
    ],
    {
      type: "text/plain;charset=utf-8"
    }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "anotacao.txt";
  a.click();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
};

// ATALHO CTRL + S
document.addEventListener("keydown", event => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s"
  ) {
    event.preventDefault();
    void save();
  }
});

// ALERTAR SOBRE ALTERAÇÕES PENDENTES
window.addEventListener("beforeunload", event => {
  if (state.dirty || state.saving) {
    event.preventDefault();
  }
});

// ================================================
// CARREGAR DADOS DO D1
// ================================================

async function loadNotebooks(preferred = null) {
  const response = await api("/api/notebooks");

  state.notebooks = response.notebooks;

  const id = state.notebooks.find(
    n => n.id === preferred
  )?.id || state.notebooks[0]?.id || null;

  await selectNotebook(id, true);
}

// SELECIONAR CADERNO
async function selectNotebook(id, skipSave = false) {
  if (!skipSave && !(await save())) return;

  const generation = state.generation;
  const nav = ++state.navigation;

  state.notebookId = id;
  state.sectionId = null;
  state.page = null;
  state.sections = [];
  state.pages = [];

  draw();
  drawEditor();

  if (!id) return;

  try {
    const result = await api(
      "/api/sections?notebook_id=" +
      encodeURIComponent(id)
    );

    if (
      generation !== state.generation ||
      nav !== state.navigation
    ) {
      return;
    }

    state.sections = result.sections;

    draw();

    await selectSection(
      state.sections[0]?.id || null,
      true
    );
  } catch (error) {
    if (generation === state.generation) {
      status(errorText(error), true);
    }
  }
}

// SELECIONAR SEÇÃO
async function selectSection(id, skipSave = false) {
  if (!skipSave && !(await save())) return;

  const generation = state.generation;
  const nav = ++state.navigation;

  state.sectionId = id;
  state.page = null;
  state.pages = [];

  draw();
  drawEditor();

  if (!id) return;

  try {
    const result = await api(
      "/api/pages?section_id=" +
      encodeURIComponent(id)
    );

    if (
      generation !== state.generation ||
      nav !== state.navigation
    ) {
      return;
    }

    state.pages = result.pages;
    state.page = state.pages[0] || null;

    draw();
    drawEditor();
  } catch (error) {
    if (generation === state.generation) {
      status(errorText(error), true);
    }
  }
}

// SELECIONAR ANOTAÇÃO
async function selectPage(id) {
  if (
    state.page?.id === id ||
    !(await save())
  ) {
    return;
  }

  state.page = state.pages.find(
    p => p.id === id
  ) || null;

  draw();
  drawEditor();
}

// RECARREGAR SEÇÕES
async function refreshSections(preferred) {
  const result = await api(
    "/api/sections?notebook_id=" +
    encodeURIComponent(state.notebookId)
  );

  state.sections = result.sections;

  await selectSection(
    state.sections.find(
      s => s.id === preferred
    )?.id || state.sections[0]?.id || null,
    true
  );
}

// RECARREGAR ANOTAÇÕES
async function refreshPages(preferred) {
  const result = await api(
    "/api/pages?section_id=" +
    encodeURIComponent(state.sectionId)
  );

  state.pages = result.pages;

  state.page = state.pages.find(
    p => p.id === preferred
  ) || state.pages[0] || null;

  draw();
  drawEditor();
}

// ================================================
// CRIAR, RENOMEAR E EXCLUIR
// ================================================

async function changeItem(kind, operation, row = null) {
  if (state.busy || !(await save())) return;

  let title = "";

  if (operation === "delete") {
    if (
      !confirm(
        `Mover "${row.title}" para a lixeira?`
      )
    ) {
      return;
    }
  } else {
    const response = prompt(
      operation === "create"
        ? "Nome do novo item:"
        : "Novo nome:",
      row?.title ||
      (kind === "pages" ? "Nova anotação" : "")
    );

    if (response === null) return;

    title = response.trim();

    if (
      title.length < 1 ||
      title.length > 100
    ) {
      return status(
        "Título inválido (1 a 100 caracteres).",
        true
      );
    }
  }

  state.busy = true;

  try {
    let result;

    if (operation === "create") {
      const body = { title };

      if (kind === "sections") {
        body.notebook_id = state.notebookId;
      }

      if (kind === "pages") {
        body.section_id = state.sectionId;
      }

      result = await api(
        "/api/" + kind,
        "POST",
        body
      );

    } else if (operation === "rename") {
      const body = { title };

      if (kind === "pages") {
        body.updated_at = row.updated_at;
      }

      result = await api(
        "/api/" + kind + "/" +
        encodeURIComponent(row.id),
        "PATCH",
        body
      );

    } else {
      await api(
        "/api/" + kind + "/" +
        encodeURIComponent(row.id),
        "DELETE"
      );
    }

    if (kind === "notebooks") {
      await loadNotebooks(
        operation === "create"
          ? result.notebook.id
          : state.notebookId
      );
    }

    if (kind === "sections") {
      await refreshSections(
        operation === "create"
          ? result.section.id
          : state.sectionId
      );
    }

    if (kind === "pages") {
      await refreshPages(
        operation === "create"
          ? result.page.id
          : state.page?.id
      );
    }

    status(
      operation === "delete"
        ? "Movido para a lixeira."
        : "Alteração salva."
    );

  } catch (error) {
    status(errorText(error), true);
  } finally {
    state.busy = false;
  }
}

// MENU DE CADA ITEM
async function itemMenu(kind, row) {
  const option = prompt(
    `O que fazer com "${row.title}"?\n` +
    "Digite R para renomear ou E para excluir.",
    "R"
  );

  if (!option) return;

  const letter = option.trim().toUpperCase();

  if (letter === "R") {
    await changeItem(kind, "rename", row);
  } else if (letter === "E") {
    await changeItem(kind, "delete", row);
  }
}

// BOTÕES DE CRIAÇÃO
$("newNotebook").onclick =
  () => void changeItem("notebooks", "create");

$("newSection").onclick =
  () => void changeItem("sections", "create");

$("newPage").onclick =
  () => void changeItem("pages", "create");

// BUSCA
$("searchInput").oninput = draw;

// ================================================
// LIXEIRA
// ================================================

async function trash() {
  const dialog = $("trashDialog");
  const container = $("trashList");

  container.replaceChildren();

  try {
    const { items } = await api("/api/trash");

    if (!items.length) {
      empty(
        container,
        "Sua lixeira está vazia."
      );
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "trash-row";

      const label = document.createElement("span");

      label.textContent =
        item.title + " · " +
        ({
          notebooks: "Caderno",
          sections: "Seção",
          pages: "Anotação"
        }[item.kind] || item.kind);

      const button = document.createElement("button");

      button.type = "button";
      button.textContent = "Restaurar";

      button.onclick = async () => {
        if (!(await save())) return;

        button.disabled = true;

        try {
          await api(
            `/api/${item.kind}/` +
            `${encodeURIComponent(item.id)}/restore`,
            "POST"
          );

          await loadNotebooks(state.notebookId);
          await trash();

          status("Item restaurado.");
        } catch (error) {
          status(
            errorText(error) +
            " Restaure primeiro o caderno/seção pai, " +
            "se também estiver excluído.",
            true
          );
        } finally {
          button.disabled = false;
        }
      };

      row.append(label, button);
      container.append(row);
    }

  } catch (error) {
    status(errorText(error), true);
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

$("openTrash").onclick = () => void trash();

$("closeTrash").onclick = () =>
  $("trashDialog").close();

// ================================================
// CONTEÚDO DE EXEMPLO
// ================================================

const examples = [
  {
    title: "Pessoal",
    sections: [
      {
        title: "Primeiros passos",
        pages: [
          {
            title: "Bem-vindo ao Minhas Anotações",
            text:
              "BEM-VINDO AO MINHAS ANOTAÇÕES\n\n" +
              "1. CADERNOS: criam grupos de assuntos.\n" +
              "2. SEÇÕES: organizam as páginas dentro de cada caderno.\n" +
              "3. ANOTAÇÕES: clique em + para criar uma página.\n" +
              "4. EDITOR: escreva e utilize Ctrl+S para salvar.\n" +
              "5. LIXEIRA: permite restaurar itens removidos.\n\n" +
              "Experimente editar este texto e atualizar " +
              "a página depois de salvar."
          },
          {
            title: "Como organizar minhas anotações",
            text:
              "Pessoal: anotações rápidas e tarefas.\n" +
              "Trabalho: reuniões e planejamento.\n" +
              "Estudos: conteúdos e revisões.\n" +
              "Projetos: ideias e acompanhamento."
          }
        ]
      },
      {
        title: "Anotações rápidas",
        pages: [
          {
            title: "Minha primeira nota",
            text:
              "Registre aqui uma ideia ou lembrete.\n\n" +
              "Você pode alterar ou excluir este exemplo."
          }
        ]
      },
      {
        title: "Tarefas",
        pages: [
          {
            title: "Lista de tarefas",
            text:
              "☐ Organizar cadernos\n" +
              "☐ Criar uma anotação\n" +
              "☐ Testar salvamento\n" +
              "☐ Revisar prioridades"
          }
        ]
      }
    ]
  },
  {
    title: "Trabalho",
    sections: [
      {
        title: "Planejamento",
        pages: [
          {
            title: "Planejamento semanal",
            text:
              "Objetivos:\n\n" +
              "Prioridades:\n\n" +
              "Pendências:\n"
          }
        ]
      },
      {
        title: "Reuniões",
        pages: [
          {
            title: "Modelo de reunião",
            text:
              "Data:\n" +
              "Participantes:\n" +
              "Pontos discutidos:\n" +
              "Decisões:\n" +
              "Próximos passos:"
          }
        ]
      }
    ]
  },
  {
    title: "Estudos",
    sections: [
      {
        title: "Conteúdos",
        pages: [
          {
            title: "Plano de estudos",
            text:
              "Assunto:\n" +
              "Objetivo:\n" +
              "Referências:\n" +
              "Próxima revisão:"
          }
        ]
      }
    ]
  },
  {
    title: "Projetos",
    sections: [
      {
        title: "Ideias",
        pages: [
          {
            title: "Modelo de projeto",
            text:
              "Objetivo:\n" +
              "Requisitos:\n" +
              "Atividades:\n" +
              "Prazos:"
          }
        ]
      }
    ]
  }
];

// ================================================
// INSERIR EXEMPLOS NO D1
// ================================================

$("insertExamples").onclick = async () => {
  if (state.busy || !(await save())) return;

  if (
    !confirm(
      "Criar exemplos nesta conta? " +
      "Nenhuma anotação existente será sobrescrita."
    )
  ) {
    return;
  }

  state.busy = true;
  $("insertExamples").disabled = true;

  const uid = state.uid;

  try {
    status("Inserindo exemplos...");

    const { notebooks } =
      await api("/api/notebooks");

    let welcomeId = null;

    for (const template of examples) {
      if (state.uid !== uid) {
        throw new Error("A conta mudou.");
      }

      let notebook = notebooks.find(n =>
        n.title === template.title ||
        (
          template.title === "Pessoal" &&
          n.title === "Pessoais"
        )
      );

      if (!notebook) {
        ({ notebook } = await api(
          "/api/notebooks",
          "POST",
          { title: template.title }
        ));

        notebooks.push(notebook);
      }

      if (template.title === "Pessoal") {
        welcomeId = notebook.id;
      }

      const { sections } = await api(
        "/api/sections?notebook_id=" +
        encodeURIComponent(notebook.id)
      );

      for (const group of template.sections) {
        let section = sections.find(
          s => s.title === group.title
        );

        if (!section) {
          ({ section } = await api(
            "/api/sections",
            "POST",
            {
              title: group.title,
              notebook_id: notebook.id
            }
          ));

          sections.push(section);
        }

        const { pages } = await api(
          "/api/pages?section_id=" +
          encodeURIComponent(section.id)
        );

        for (const sample of group.pages) {
          if (
            pages.some(
              p => p.title === sample.title
            )
          ) {
            continue;
          }

          const { page } = await api(
            "/api/pages",
            "POST",
            {
              title: sample.title,
              section_id: section.id
            }
          );

          const { page: saved } = await api(
            "/api/pages/" + page.id,
            "PATCH",
            {
              title: sample.title,
              content_json: encode(sample.text),
              updated_at: page.updated_at
            }
          );

          pages.push(saved);
        }
      }
    }

    await loadNotebooks(welcomeId);

    status("Exemplos criados no banco D1.");
  } catch (error) {
    status(
      errorText(error) +
      " Repita a operação para concluir " +
      "os itens restantes.",
      true
    );
  } finally {
    state.busy = false;
    $("insertExamples").disabled = false;
  }
};

// ================================================
// INICIALIZAÇÃO DA SESSÃO
// ================================================

async function enter(user) {
  const generation = ++state.generation;

  state.uid = user.uid;

  $("accountEmail").textContent =
    user.email || "Conta autenticada";

  show("appView");

  status("Carregando anotações...");

  try {
    await api("/api/users/sync", "POST");

    if (generation !== state.generation) {
      return;
    }

    await loadNotebooks();

    if (generation === state.generation) {
      status(
        "Conectado. Dados privados carregados do D1."
      );
    }
  } catch (error) {
    if (generation === state.generation) {
      status(errorText(error), true);
    }
  }
}

// MONITORAR LOGIN FIREBASE
onAuthStateChanged(auth, async user => {
  ++state.generation;
  ++state.navigation;

  clearTimeout(autosaveTimer);

  state.uid = null;
  state.notebooks = [];
  state.sections = [];
  state.pages = [];
  state.notebookId = null;
  state.sectionId = null;
  state.page = null;
  state.dirty = false;
  state.saving = null;

  draw();
  drawEditor();

  if (!user) {
    return show("loginView");
  }

  try {
    await reload(user);
  } catch {
    // O token será verificado na API.
  }

  if (auth.currentUser?.uid !== user.uid) {
    return;
  }

  if (!user.emailVerified) {
    return show("verifyView");
  }

  await enter(user);
});

// LOGOUT
$("logoutButton").onclick = async () => {
  if (!(await save())) {
    return status(
      "Salve ou baixe o rascunho antes de sair.",
      true
    );
  }

  try {
    await signOut(auth);
  } catch (error) {
    status(errorText(error), true);
  }
};
