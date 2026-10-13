/*
 * Minhas Anotações — Mover ou copiar páginas entre cadernos/seções.
 * Complemento ao app.js. Nunca envia credenciais para serviços externos.
 * Requer MyNotesTransferAdapter no fim do app.js (ver instrucoes).
 * Não migra esquema D1 nem interpreta/regrava content_json.
 */
(() => {
  "use strict";

  const root = document.getElementById("appView");
  if (!root) return;

  const bridge = () => window.MyNotesTransferAdapter;
  const esc = value => encodeURIComponent(String(value));
  const $ = id => document.getElementById(id);

  const dialog = document.createElement("dialog");
  dialog.id = "mnTransferDialog";
  dialog.className = "mn-transfer-dialog";
  dialog.setAttribute("aria-labelledby", "mnTransferTitle");
  dialog.innerHTML = `
    <form id="mnTransferForm" method="dialog" novalidate>
      <div class="mn-transfer-header">
        <div class="mn-transfer-mark" aria-hidden="true">⇄</div>
        <div><h2 id="mnTransferTitle">Mover ou copiar anotação</h2>
          <p id="mnTransferSource" class="mn-transfer-subtitle"></p></div>
        <button id="mnTransferClose" type="button" class="mn-transfer-close" aria-label="Fechar">×</button>
      </div>
      <fieldset class="mn-transfer-modes">
        <legend>Operação</legend>
        <label><input type="radio" name="mnTransferMode" value="move" checked>
          <span><strong>Mover</strong><small>A anotação original será enviada à lixeira após a cópia ser conferida.</small></span></label>
        <label><input type="radio" name="mnTransferMode" value="copy">
          <span><strong>Copiar</strong><small>Cria outra anotação e mantém a original.</small></span></label>
      </fieldset>
      <div class="mn-transfer-field"><label for="mnTargetBook">Caderno de destino</label>
        <select id="mnTargetBook" required></select></div>
      <div class="mn-transfer-field"><label for="mnTargetSection">Seção de destino</label>
        <select id="mnTargetSection" required></select></div>
      <p id="mnTransferFeedback" role="status" aria-live="polite" class="mn-transfer-feedback"></p>
      <div class="mn-transfer-actions">
        <button id="mnTransferCancel" type="button" class="mn-transfer-cancel">Cancelar</button>
        <button id="mnTransferSubmit" type="submit" class="mn-transfer-submit">Mover anotação</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const form = $("mnTransferForm");
  const bookSelect = $("mnTargetBook");
  const sectionSelect = $("mnTargetSection");
  const submit = $("mnTransferSubmit");
  const feedback = $("mnTransferFeedback");
  let selection = null;
  let busy = false;
  let loadGeneration = 0;

  function message(text, isError = false) {
    feedback.textContent = text || "";
    feedback.classList.toggle("error", isError);
  }

  function mode() {
    return form.elements.mnTransferMode.value;
  }

  function canTransfer() {
    const target = sectionSelect.value;
    const sameSection = selection && target === selection.sourceSectionId;
    const valid = !!selection && !!bookSelect.value && !!target &&
      (mode() === "copy" || !sameSection);
    submit.disabled = busy || !valid;
    if (!busy && sameSection && mode() === "move") {
      message("Para mover, escolha uma seção diferente da atual.");
    } else if (!busy && !feedback.classList.contains("error")) {
      message("");
    }
    submit.textContent = mode() === "move" ? "Mover anotação" : "Copiar anotação";
    return valid;
  }

  function setBusy(value) {
    busy = value;
    bookSelect.disabled = value;
    sectionSelect.disabled = value;
    form.querySelectorAll('[name="mnTransferMode"]').forEach(el => el.disabled = value);
    $("mnTransferClose").disabled = value;
    $("mnTransferCancel").disabled = value;
    canTransfer();
  }

  async function loadSections(initialSectionId) {
    const bridgeRef = bridge();
    const expectedUid = selection?.uid;
    const notebookId = bookSelect.value;
    const generation = ++loadGeneration;
    sectionSelect.replaceChildren(new Option("Carregando seções…", ""));
    sectionSelect.disabled = true;
    submit.disabled = true;
    if (!notebookId) return;
    try {
      const result = await bridgeRef.request(
        "/api/sections?notebook_id=" + esc(notebookId)
      );
      if (generation !== loadGeneration || !selection ||
          bridge()?.snapshot()?.uid !== expectedUid) return;
      sectionSelect.replaceChildren(new Option("Selecione uma seção", ""));
      for (const section of result.sections || []) {
        sectionSelect.append(new Option(section.title, section.id));
      }
      if (initialSectionId && (result.sections || []).some(s => s.id === initialSectionId)) {
        sectionSelect.value = initialSectionId;
      } else if ((result.sections || []).length) {
        sectionSelect.value = result.sections[0].id;
      }
      if (!(result.sections || []).length) {
        message("Esse caderno ainda não possui seções. Crie uma seção antes de transferir.");
      }
    } catch (error) {
      if (generation === loadGeneration) {
        sectionSelect.replaceChildren(new Option("Erro ao carregar seções", ""));
        message(error?.message || "Erro ao carregar seções.", true);
      }
    } finally {
      if (generation === loadGeneration) {
        sectionSelect.disabled = busy;
        canTransfer();
      }
    }
  }

  async function open({ pageId, title, mode: requestedMode = "move" } = {}) {
    if (busy) return;
    const b = bridge();
    const snapshot = b?.snapshot();
    if (!snapshot?.uid || !pageId || typeof b?.saveCurrent !== "function") {
      window.alert("Selecione uma anotação e aguarde a sincronização.");
      return;
    }
    selection = {
      uid: snapshot.uid,
      pageId: String(pageId),
      title: String(title || "Anotação"),
      sourceSectionId: snapshot.sectionId
    };
    $("mnTransferSource").textContent = selection.title;
    form.elements.mnTransferMode.value = requestedMode === "copy" ? "copy" : "move";
    message("");
    bookSelect.replaceChildren(new Option("Carregando cadernos…", ""));
    sectionSelect.replaceChildren(new Option("Selecione um caderno", ""));
    dialog.showModal();

    try {
      const result = await b.request("/api/notebooks");
      if (!selection || snapshot.uid !== bridge()?.snapshot()?.uid) {
        dialog.close();
        return;
      }
      const books = result.notebooks || [];
      bookSelect.replaceChildren(new Option("Selecione um caderno", ""));
      for (const book of books) bookSelect.append(new Option(book.title, book.id));
      if (books.some(book => book.id === snapshot.notebookId)) {
        bookSelect.value = snapshot.notebookId;
      }
      await loadSections(snapshot.sectionId);
    } catch (error) {
      bookSelect.replaceChildren(new Option("Erro ao carregar cadernos", ""));
      message(error?.message || "Não foi possível consultar os cadernos.", true);
    }
  }

  // O backend atual não expõe PATCH section_id. A transferência é realizada
  // por criação + cópia fiel + verificação; somente depois MOVE exclui a origem.
  async function transfer({ pageId, targetBookId, targetSectionId, operation, uid }) {
    const b = bridge();
    const assertUser = () => {
      if (!b || b.snapshot()?.uid !== uid) {
        throw new Error("A conta mudou durante a operação. Transferência cancelada.");
      }
    };
    assertUser();
    if (!(await b.saveCurrent())) {
      throw new Error("A anotação aberta não foi salva. Salve-a antes de transferir.");
    }
    assertUser();

    const [sourceReply, notebookReply, sectionReply] = await Promise.all([
      b.request("/api/pages/" + esc(pageId)),
      b.request("/api/notebooks"),
      b.request("/api/sections?notebook_id=" + esc(targetBookId))
    ]);
    assertUser();
    const source = sourceReply.page;
    if (!source || source.id !== pageId || typeof source.content_json !== "string") {
      throw new Error("Não foi possível ler a anotação original.");
    }
    if (!(notebookReply.notebooks || []).some(n => n.id === targetBookId) ||
        !(sectionReply.sections || []).some(s => s.id === targetSectionId)) {
      throw new Error("O caderno ou a seção de destino não está disponível.");
    }
    if (operation === "move" && source.section_id === targetSectionId) {
      throw new Error("A anotação já pertence à seção escolhida.");
    }

    const newPageReply = await b.request("/api/pages", "POST", {
      section_id: targetSectionId,
      title: source.title
    });
    const newPage = newPageReply.page;
    if (!newPage?.id || !newPage.updated_at) {
      throw new Error("A API não retornou os dados da nova anotação. Confira o destino.");
    }
    let verified = false;
    try {
      assertUser();
      await b.request("/api/pages/" + esc(newPage.id), "PATCH", {
        title: source.title,
        content_json: source.content_json,
        updated_at: newPage.updated_at
      });
      const checked = (await b.request("/api/pages/" + esc(newPage.id))).page;
      assertUser();
      verified = checked?.content_json === source.content_json &&
        checked?.title === source.title;
      if (!verified) throw new Error("A cópia não passou na verificação de integridade.");
    } catch (error) {
      // O original nunca é excluído se a cópia falhar. A cópia incompleta
      // é descartada na lixeira, sem afetar o conteúdo de origem.
      let cleanup = "";
      try { await b.request("/api/pages/" + esc(newPage.id), "DELETE"); }
      catch { cleanup = " Verifique e exclua a cópia incompleta manualmente."; }
      throw new Error((error?.message || "Falha ao copiar conteúdo.") +
        " A anotação original foi preservada." + cleanup);
    }

    let warning = "";
    if (operation === "move") {
      // Confirma que o original não foi alterado em outra aba após a cópia.
      // Esta verificação reduz riscos, mas a API atual não oferece operação
      // atômica de transferência entre seções.
      try {
        assertUser();
        const rechecked = (await b.request("/api/pages/" + esc(pageId))).page;
        if (!rechecked || rechecked.updated_at !== source.updated_at ||
            rechecked.content_json !== source.content_json ||
            rechecked.title !== source.title) {
          throw new Error("A origem foi alterada durante a transferência.");
        }
        await b.request("/api/pages/" + esc(pageId), "DELETE");
      } catch (error) {
        warning = (error?.message || "Não foi possível remover a origem.") +
          " A cópia está salva, mas a anotação original continua disponível.";
      }
    }

    let opened = false;
    try {
      assertUser();
      opened = await b.openPage({
        notebookId: targetBookId,
        sectionId: targetSectionId,
        pageId: newPage.id
      });
    } catch { /* A cópia já está salva no D1. */ }
    return { copiedPageId: newPage.id, warning, opened };
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || !selection || !canTransfer()) return;
    const action = mode();
    const context = { ...selection };
    const targetBookId = bookSelect.value;
    const targetSectionId = sectionSelect.value;
    setBusy(true);
    message(action === "move" ? "Copiando e conferindo os dados antes de mover…" :
      "Copiando e conferindo os dados…");
    try {
      const result = await transfer({
        pageId: context.pageId,
        targetBookId,
        targetSectionId,
        operation: action,
        uid: context.uid
      });
      dialog.close();
      const bar = $("statusBar");
      if (bar) {
        bar.textContent = result.warning ||
          (action === "move" ? "Anotação movida com sucesso." : "Anotação copiada com sucesso.");
        bar.classList.toggle("error", !!result.warning);
      }
      if (result.warning) window.alert(result.warning);
      else if (!result.opened) window.alert("Transferência concluída. Selecione a seção de destino para abrir a cópia.");
    } catch (error) {
      message(error?.message || "Não foi possível transferir a anotação.", true);
    } finally {
      setBusy(false);
    }
  });

  bookSelect.addEventListener("change", () => { message(""); void loadSections(null); });
  sectionSelect.addEventListener("change", () => { message(""); canTransfer(); });
  form.querySelectorAll('[name="mnTransferMode"]').forEach(el =>
    el.addEventListener("change", () => { message(""); canTransfer(); })
  );
  $("mnTransferClose").onclick = () => { if (!busy) dialog.close(); };
  $("mnTransferCancel").onclick = () => { if (!busy) dialog.close(); };
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    selection = null;
    ++loadGeneration;
    message("");
  });

  // Ação também acessível diretamente na barra do editor avançado.
  const toolbar = root.querySelector(".rich-toolbar");
  const actions = toolbar || root.querySelector(".editor-tools");
  if (actions) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = "mnTransferTrigger";
    trigger.className = "mn-transfer-trigger";
    trigger.title = "Mover ou copiar a anotação selecionada";
    trigger.textContent = "⇄ Mover / Copiar";
    trigger.onclick = () => {
      const snapshot = bridge()?.snapshot();
      const currentPage = snapshot?.pages?.find(p => p.id === snapshot.pageId);
      if (currentPage) void open({pageId: currentPage.id, title: currentPage.title, mode: "move"});
    };
    const anchor = actions.querySelector(".rich-grow");
    if (anchor) actions.insertBefore(trigger, anchor);
    else actions.prepend(trigger);
  }

  window.MyNotesTransfer = Object.freeze({ open });
})();
