/*
 * Minhas Anotações — Pesquisa global e filtros de páginas.
 * Complemento ao app.js, dashboard.js e rich-editor.js.
 * Não grava dados no D1; usa a API autenticada exposta pelo MyNotesBridge.
 */
(() => {
  'use strict';

  const bridge = () => window.MyNotesBridge;
  const root = document.getElementById('appView');
  let headerSearch = root?.querySelector('.global-search-box');
  // dashboard.js usa <label> como caixa de busca. Um popover com botões
  // não pode ser filho de label; convertemos para div preservando o input.
  if (headerSearch?.tagName === 'LABEL') {
    const wrapper = document.createElement('div');
    wrapper.className = headerSearch.className;
    while (headerSearch.firstChild) wrapper.append(headerSearch.firstChild);
    headerSearch.replaceWith(wrapper);
    headerSearch = wrapper;
  }
  const input = headerSearch?.querySelector('input[type="search"]');
  const sectionList = document.getElementById('pagesList');
  const sectionSearch = document.getElementById('searchInput');
  if (!root || !headerSearch || !input || !sectionList || !sectionSearch) {
    console.warn('Pesquisa: faltam elementos da interface.');
    return;
  }

  // Não permita que a antiga pesquisa do dashboard.js substitua esta
  // pesquisa global por uma pesquisa limitada à seção selecionada.
  const ignoreOldSearchListener = event => {
    if (event.target !== input) return;
    event.stopPropagation();
    scheduleSearch();
  };
  headerSearch.addEventListener('input', ignoreOldSearchListener, true);

  const overlay = document.createElement('section');
  overlay.className = 'mn-search-popover';
  overlay.setAttribute('role', 'region');
  overlay.setAttribute('aria-label', 'Pesquisa global de anotações');
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="mn-search-head">
      <strong>Pesquisar em todos os cadernos</strong>
      <button type="button" class="mn-search-close" aria-label="Fechar resultados">×</button>
    </div>
    <div class="mn-filter-controls">
      <label><span>Tag</span><select class="mn-global-tag"><option value="">Todas as tags</option></select></label>
      <label class="mn-check-option"><input class="mn-global-favorites" type="checkbox"><span>Somente favoritas</span></label>
      <button class="mn-search-refresh" type="button" title="Atualizar resultados do banco de dados">Atualizar</button>
    </div>
    <p class="mn-global-hint">Digite para pesquisar título, conteúdo ou tag em todos os seus cadernos.</p>
    <div class="mn-search-results" role="list"></div>
    <p class="mn-search-foot">Use Ctrl/⌘ + K para pesquisar · Esc para fechar</p>`;
  headerSearch.append(overlay);

  const globalTag = overlay.querySelector('.mn-global-tag');
  const onlyFavorite = overlay.querySelector('.mn-global-favorites');
  const results = overlay.querySelector('.mn-search-results');
  const hint = overlay.querySelector('.mn-global-hint');
  const refresh = overlay.querySelector('.mn-search-refresh');

  const localFilter = document.createElement('div');
  localFilter.className = 'mn-section-filters';
  localFilter.setAttribute('aria-label', 'Filtros desta seção');
  localFilter.innerHTML = `
    <label class="mn-section-tag-wrap"><span class="sr-only">Filtrar por tag</span>
      <select class="mn-section-tag"><option value="">Todas as tags</option></select>
    </label>
    <label class="mn-section-favorite-wrap" title="Exibir apenas páginas favoritas">
      <input class="mn-section-favorite" type="checkbox"><span>☆ Favoritas</span>
    </label>`;
  sectionList.before(localFilter);
  const sectionTag = localFilter.querySelector('.mn-section-tag');
  const sectionFavorite = localFilter.querySelector('.mn-section-favorite');

  let index = [];
  let lastIndexedUid = null;
  let lastIndexedAt = 0;
  let pending = null;
  let searchTimer = null;
  let currentSectionId = null;
  let filterRaf = null;
  const CACHE_MS = 60_000;
  const MAX_RESULTS = 35;

  function normalize(text) {
    return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  }
  function extractText(html) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    // DOMParser constrói um documento inerte. Não inserimos o HTML no DOM real.
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function pageInfo(row) {
    let raw = '';
    try {
      const doc = JSON.parse(row?.content_json || '{}');
      raw = typeof doc?.text === 'string' ? doc.text : '';
    } catch { raw = String(row?.content_json || ''); }
    if (raw.startsWith('MYNOTES_RICH_V1:')) {
      try {
        const data = JSON.parse(raw.slice('MYNOTES_RICH_V1:'.length));
        return {
          tags: Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string').map(t => t.trim()).filter(Boolean) : [],
          favorite: data.favorite === true,
          text: extractText(data.html || '')
        };
      } catch { /* Conteúdo antigo ou inválido: ainda pode ser encontrado pelo título. */ }
    }
    return { tags: [], favorite: false, text: raw };
  }
  function readableDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'});
  }
  function fillSelect(select, tags) {
    const selected = select.value;
    const options = [...new Set(tags)].sort((a,b) => a.localeCompare(b,'pt-BR'));
    select.replaceChildren(new Option('Todas as tags',''));
    for (const t of options) select.add(new Option('# '+t,t));
    select.value = options.includes(selected) ? selected : '';
  }
  async function pool(items, limit, fn) {
    const data = new Array(items.length);
    let position = 0;
    const runner = async () => {
      while (position < items.length) {
        const i = position++;
        data[i] = await fn(items[i], i);
      }
    };
    await Promise.all(Array.from({length: Math.min(limit,items.length)},runner));
    return data;
  }
  function checkUid(uid) {
    if (bridge()?.snapshot().uid !== uid) throw new Error('A sessão mudou; refaça a pesquisa.');
  }
  async function fetchIndex(force=false) {
    const api = bridge();
    if (!api) throw new Error('Integração da pesquisa não instalada no app.js.');
    const uid = api.snapshot().uid;
    if (!uid) throw new Error('Entre na sua conta para pesquisar.');
    if (!force && lastIndexedUid === uid && Date.now()-lastIndexedAt<CACHE_MS) return index;
    if (pending) return pending;
    pending = (async () => {
      hint.textContent = 'Carregando páginas dos seus cadernos…';
      const booksResponse = await api.request('/api/notebooks');
      checkUid(uid);
      const notebooks = booksResponse.notebooks || [];
      const allGroups = await pool(notebooks,3,async book => {
        const data = await api.request('/api/sections?notebook_id='+encodeURIComponent(book.id));
        checkUid(uid);
        return (data.sections || []).map(section => ({book,section}));
      });
      const groups = allGroups.flat();
      const pageGroups = await pool(groups,4,async group => {
        const data = await api.request('/api/pages?section_id='+encodeURIComponent(group.section.id));
        checkUid(uid);
        return (data.pages || []).map(row => ({
          id:row.id,
          title:row.title,
          updated_at:row.updated_at,
          notebookId:group.book.id,
          notebookTitle:group.book.title,
          sectionId:group.section.id,
          sectionTitle:group.section.title,
          ...pageInfo(row)
        }));
      });
      index = pageGroups.flat().sort((a,b) => Date.parse(b.updated_at||0)-Date.parse(a.updated_at||0));
      lastIndexedUid = uid;
      lastIndexedAt = Date.now();
      fillSelect(globalTag,index.flatMap(p=>p.tags));
      return index;
    })().finally(()=>{ pending=null; });
    return pending;
  }
  function displayMessage(message) {
    results.replaceChildren();
    const p=document.createElement('p');p.className='mn-search-message';p.textContent=message;
    results.append(p);
  }
  function createResult(page) {
    const button=document.createElement('button');
    button.type='button';button.className='mn-result';button.setAttribute('role','listitem');
    const heading=document.createElement('span');heading.className='mn-result-heading';
    const label=document.createElement('strong');label.textContent=page.title;
    const star=document.createElement('span');star.className='mn-result-star';star.textContent=page.favorite?'★':'';
    heading.append(label,star);
    const subtitle=document.createElement('span');subtitle.className='mn-result-path';
    subtitle.textContent=page.notebookTitle+' / '+page.sectionTitle+' · '+readableDate(page.updated_at);
    const snippet=document.createElement('span');snippet.className='mn-result-preview';
    snippet.textContent=page.text.slice(0,145);
    button.append(heading,subtitle,snippet);
    button.addEventListener('click',async()=>{
      button.disabled=true;
      try {
        const ok=await bridge().openPage({notebookId:page.notebookId,sectionId:page.sectionId,pageId:page.id});
        if (!ok) throw new Error('Não foi possível abrir a página. Tente atualizar a pesquisa.');
        input.value='';overlay.hidden=true;
        sectionList.querySelector('.page-item.active')?.scrollIntoView({block:'nearest'});
      } catch(error) { hint.textContent=error.message;button.disabled=false; }
    });
    return button;
  }
  function drawResults() {
    const term=normalize(input.value.trim());
    const tag=normalize(globalTag.value);
    const favorites=onlyFavorite.checked;
    if (!term && !tag && !favorites) {
      hint.textContent=`${index.length} página(s) encontrada(s) na sua conta.`;
      displayMessage('Digite um termo ou selecione uma tag ou favoritas.');
      return;
    }
    const terms=term.split(/\s+/).filter(Boolean);
    const found=index.filter(page => {
      if (favorites && !page.favorite) return false;
      if (tag && !page.tags.some(t => normalize(t)===tag)) return false;
      const haystack=normalize([page.title,page.text,page.notebookTitle,page.sectionTitle,...page.tags].join(' '));
      return terms.every(t => haystack.includes(t));
    });
    hint.textContent=`${found.length} resultado(s) em todos os cadernos`;
    results.replaceChildren(...found.slice(0,MAX_RESULTS).map(createResult));
    if (!found.length) displayMessage('Nenhuma anotação corresponde aos filtros.');
    if (found.length>MAX_RESULTS) {
      const more=document.createElement('p');more.className='mn-search-message';
      more.textContent=`Exibindo ${MAX_RESULTS} de ${found.length} resultados. Refine a pesquisa.`;
      results.append(more);
    }
  }
  async function runGlobal(force=false) {
    overlay.hidden=false;
    try {await fetchIndex(force); if (!overlay.hidden) drawResults();}
    catch(e){ if (!overlay.hidden) {hint.textContent='Não foi possível pesquisar.'; displayMessage(e.message || 'Erro de comunicação.');} }
  }
  function scheduleSearch() {
    clearTimeout(searchTimer);
    overlay.hidden=false;
    searchTimer=setTimeout(()=>void runGlobal(),180);
  }
  input.addEventListener('focus',()=>void runGlobal());
  globalTag.addEventListener('change',drawResults);
  onlyFavorite.addEventListener('change',drawResults);
  refresh.addEventListener('click',()=>void runGlobal(true));
  overlay.querySelector('.mn-search-close').addEventListener('click',()=>{overlay.hidden=true;input.blur();});
  document.addEventListener('pointerdown',event=>{
    if (!headerSearch.contains(event.target)) overlay.hidden=true;
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !overlay.hidden){overlay.hidden=true;input.blur();}
  });

  function applySectionFilters() {
    const snap=bridge()?.snapshot();
    if (!snap || !snap.uid) return;
    const pages=snap.pages || [];
    const favoriteOnly=sectionFavorite.checked;
    const tag=normalize(sectionTag.value);
    const typed=normalize(sectionSearch.value.trim());
    const visiblePages=pages.filter(p=>normalize(p.title+' '+pageInfo(p).text).includes(typed));
    const rows=[...sectionList.querySelectorAll('.page-item')];
    for (let i=0;i<rows.length;i++) {
      const page=visiblePages[i];
      if(!page) continue;
      const info=pageInfo(page);
      const passes=(!favoriteOnly||info.favorite)&&(!tag||info.tags.some(t=>normalize(t)===tag));
      rows[i].hidden=!passes;
      rows[i].classList.toggle('mn-is-favorite',info.favorite);
      const title=rows[i].querySelector('.row-name');
      if(title && !title.querySelector('.mn-favorite-indicator') && info.favorite) {
        const icon=document.createElement('span');icon.className='mn-favorite-indicator';
        icon.textContent='★';icon.setAttribute('aria-label','Favorita');
        title.append(icon);
      }
    }
    let note=sectionList.querySelector('.mn-filter-empty');
    const shown=rows.filter(n=>!n.hidden).length;
    if(rows.length && !shown){
      if(!note){note=document.createElement('p');note.className='mn-filter-empty';sectionList.append(note);}
      note.textContent='Nenhuma página corresponde aos filtros desta seção.';
    }else note?.remove();
  }
  function synchronizeSection() {
    const snap=bridge()?.snapshot();
    if (!snap) return;
    if (snap.sectionId !== currentSectionId) {
      sectionFavorite.checked=false;
      sectionTag.value='';
      currentSectionId=snap.sectionId;
    }
    fillSelect(sectionTag,(snap.pages||[]).flatMap(p=>pageInfo(p).tags));
    applySectionFilters();
  }
  function queueSectionUpdate(){
    if(filterRaf!==null) return;
    filterRaf=requestAnimationFrame(()=>{filterRaf=null;synchronizeSection();});
  }
  sectionTag.addEventListener('change',applySectionFilters);
  sectionFavorite.addEventListener('change',applySectionFilters);
  sectionSearch.addEventListener('input',queueSectionUpdate);
  new MutationObserver(queueSectionUpdate).observe(sectionList,{childList:true,subtree:false});
  window.addEventListener('mynotes:render',queueSectionUpdate);
  queueSectionUpdate();
})();
