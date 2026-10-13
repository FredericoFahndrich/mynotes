/* Minhas Anotações — editor avançado, módulo complementar.
   Compatível com app.js atual: a gravação e autenticação continuam nele.
   Conteúdo formatado é salvo no content_json, dentro do campo text do formato
   mynotes-text existente, para evitar migração destrutiva do banco.
*/

const PREFIX = 'MYNOTES_RICH_V1:';
const MAX_BYTES = 220000;
const ALLOWED = new Set([
  'P','DIV','BR','H2','H3','H4','STRONG','B','EM','I','U','S','DEL',
  'UL','OL','LI','BLOCKQUOTE','A','IMG','FIGURE','FIGCAPTION',
  'TABLE','THEAD','TBODY','TR','TH','TD','SPAN','INPUT','HR'
]);
const CLASSES = new Set([
  'rich-checklist','rich-quote-card','rich-tip-card','rich-media-grid',
  'rich-image-panel','rich-goals','rich-callout','rich-mountain-image'
]);

const editorView = document.getElementById('editorView');
const textarea = document.getElementById('pageText');
const title = document.getElementById('pageTitle');
const saveButton = document.getElementById('saveButton');
const status = document.getElementById('statusBar');

if (!editorView || !textarea || !title || !saveButton) {
  console.warn('Editor avançado: HTML incompatível. A interface original foi mantida.');
} else {
  initializeRichEditor();
}

function safeUrl(value, image = false) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol === 'https:' || (!image && u.protocol === 'http:')) return u.href;
    if (!image && u.protocol === 'mailto:') return u.href;
  } catch { /* Endereço inválido */ }
  return null;
}

function cleanHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html), 'text/html');
  // Guardamos atributos permitidos antes de limpar os demais.
  for (const element of parsed.body.querySelectorAll('img,a,input')) {
    if (element.tagName === 'IMG') {
      element.dataset.safeSrc = element.getAttribute('src') || '';
      element.dataset.safeAlt = element.getAttribute('alt') || '';
    }
    if (element.tagName === 'A') element.dataset.safeHref = element.getAttribute('href') || '';
    if (element.tagName === 'INPUT') {
      element.dataset.safeType = (element.getAttribute('type') || '').toLowerCase();
      element.dataset.safeChecked = element.checked || element.hasAttribute('checked') ? 'true' : 'false';
    }
  }
  function cleanTree(node) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName;
      if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','SVG','MATH','VIDEO','AUDIO','META','LINK'].includes(tag)) { child.remove(); continue; }
      if (!ALLOWED.has(tag)) { cleanTree(child); child.replaceWith(...Array.from(child.childNodes)); continue; }
      const attrs = {src:child.dataset.safeSrc,alt:child.dataset.safeAlt,href:child.dataset.safeHref,checked:child.dataset.safeChecked,type:child.dataset.safeType};
      const cl = (typeof child.className === 'string' ? child.className.split(/\s+/) : []).filter(v => CLASSES.has(v));
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
      if (tag === 'IMG') {
        const src = safeUrl(attrs.src, true);
        if (!src) { child.remove(); continue; }
        child.setAttribute('src',src); child.setAttribute('alt',(attrs.alt||'').slice(0,150));
        child.setAttribute('loading','lazy'); child.setAttribute('referrerpolicy','no-referrer');
      }
      if (tag === 'A') {
        const href = safeUrl(attrs.href);
        if (href) { child.setAttribute('href',href); child.setAttribute('target','_blank'); child.setAttribute('rel','noopener noreferrer'); }
      }
      if (tag === 'INPUT') {
        if (attrs.type !== 'checkbox') { child.remove(); continue; }
        child.setAttribute('type','checkbox'); child.setAttribute('contenteditable','false');
        if (attrs.checked === 'true') child.setAttribute('checked','');
      }
      if (cl.length) child.setAttribute('class',cl.join(' '));
      cleanTree(child);
    }
  }
  cleanTree(parsed.body);
  return parsed.body.innerHTML;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function plainToHtml(text) {
  const normalized = String(text || '').replace(/\r\n?/g,'\n');
  if (!normalized.trim()) return '<p><br></p>';
  return normalized.split(/\n\s*\n/g)
    .map(chunk => '<p>' + chunk.split('\n').map(escapeHtml).join('<br>') + '</p>').join('');
}

function parseValue(value) {
  if (!value?.startsWith(PREFIX)) return { html:plainToHtml(value), tags:[], favorite:false };
  try {
    const data = JSON.parse(value.slice(PREFIX.length));
    if (data.version !== 1 || typeof data.html !== 'string') throw new Error('Version');
    return {
      html:cleanHtml(data.html),
      tags:Array.isArray(data.tags) ? data.tags.filter(t=>typeof t==='string').slice(0,8).map(t=>t.slice(0,30)) : [],
      favorite:data.favorite===true
    };
  } catch {
    return {html:plainToHtml(value),tags:[],favorite:false};
  }
}

function initializeRichEditor() {
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-toolbar';
  toolbar.setAttribute('role','toolbar');
  toolbar.setAttribute('aria-label','Formatação da anotação');
  toolbar.innerHTML = `
    <select id="richBlock" aria-label="Estilo do texto" title="Estilo do texto">
      <option value="p">Normal</option><option value="h2">Título</option><option value="h3">Subtítulo</option>
    </select>
    <span class="rich-separator"></span>
    <button type="button" data-command="bold" title="Negrito (Ctrl+B)"><b>B</b></button>
    <button type="button" data-command="italic" title="Itálico (Ctrl+I)"><i>I</i></button>
    <button type="button" data-command="underline" title="Sublinhado (Ctrl+U)"><u>U</u></button>
    <span class="rich-separator"></span>
    <button type="button" data-command="insertUnorderedList" title="Lista com marcadores">☷</button>
    <button type="button" data-command="insertOrderedList" title="Lista numerada">☰</button>
    <button type="button" id="richChecklist" title="Inserir checklist">☑</button>
    <span class="rich-separator"></span>
    <button type="button" id="richLink" title="Adicionar link">↗</button>
    <button type="button" id="richImage" title="Adicionar imagem por endereço HTTPS">▧</button>
    <button type="button" id="richTable" title="Inserir tabela">▦</button>
    <button type="button" id="richQuote" title="Adicionar citação">❝</button>
    <span class="rich-separator"></span>
    <button type="button" id="richTemplate" title="Inserir modelo de planejamento semanal">◫</button>
    <span class="rich-grow"></span>
    <button type="button" id="richFavorite" aria-pressed="false" title="Marcar favorita">☆</button>
    <button type="button" id="richExport" title="Exportar anotação como HTML">↓</button>
  `;
  editorView.insertBefore(toolbar, editorView.firstChild);

  const tags = document.createElement('div');
  tags.className = 'rich-tags';
  tags.innerHTML = '<span class="rich-tags-list" aria-label="Tags da anotação"></span><button class="rich-add-tag" type="button">+ Adicionar tag</button>';
  const meta = editorView.querySelector('.editor-meta');
  if (meta) meta.after(tags);
  else title.after(tags);

  const rich = document.createElement('div');
  rich.className = 'rich-content';
  rich.id = 'richContent';
  rich.setAttribute('contenteditable','true');
  rich.setAttribute('role','textbox');
  rich.setAttribute('aria-label','Conteúdo da anotação');
  rich.setAttribute('aria-multiline','true');
  rich.dataset.placeholder = 'Comece a escrever...';
  textarea.after(rich);
  textarea.classList.add('rich-source-textarea');
  const footer = editorView.querySelector('.real-footer span:first-child');
  if (footer) footer.textContent = 'Editor formatado';

  const floating = document.createElement('button');
  floating.type='button';
  floating.id='richNewNote';
  floating.className='rich-new-note';
  floating.textContent='＋ Nova anotação  ⌄';
  floating.title='Criar uma anotação nesta seção';
  document.querySelector('#appView .panel-editor')?.append(floating);
  floating.addEventListener('click',()=>document.getElementById('newPage')?.click());

  const originalValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
  if (!originalValue?.get || !originalValue?.set) { toolbar.remove(); rich.remove(); return; }
  let internalWrite = false;
  let savedMetadata = {tags:[],favorite:false};
  let lastValue = undefined;

  Object.defineProperty(textarea,'value',{
    configurable:true,
    get() {return originalValue.get.call(this);},
    set(value) {
      originalValue.set.call(this,value);
      if (!internalWrite) {
        const newValue=String(value);
        queueMicrotask(()=>{
          if (textarea.value!==newValue) return;
          loadFromTextarea(newValue);
        });
      }
    }
  });

  function loadFromTextarea(value) {
    if (lastValue===value && document.activeElement===rich) return;
    lastValue=value;
    const data=parseValue(value);
    savedMetadata={tags:data.tags,favorite:data.favorite};
    rich.innerHTML=data.html;
    renderMeta();
    queueMicrotask(()=>{rich.contentEditable=textarea.readOnly?'false':'true';});
  }

  function renderMeta() {
    toolbar.querySelector('#richFavorite').textContent=savedMetadata.favorite?'★':'☆';
    toolbar.querySelector('#richFavorite').setAttribute('aria-pressed',String(savedMetadata.favorite));
    const root=tags.querySelector('.rich-tags-list');
    root.replaceChildren();
    savedMetadata.tags.forEach((tag,index)=>{
      const b=document.createElement('button');b.type='button';b.className='rich-tag';b.title='Remover tag';
      b.textContent='# '+tag+'  ×';
      b.onclick=()=>{savedMetadata.tags.splice(index,1);renderMeta();sync();};
      root.append(b);
    });
  }

  function sync() {
    if (textarea.readOnly) return;
    const html=cleanHtml(rich.innerHTML);
    const payload=PREFIX+JSON.stringify({version:1,html,tags:savedMetadata.tags,favorite:savedMetadata.favorite});
    const bytes=new TextEncoder().encode(payload).length;
    internalWrite=true;
    textarea.value=payload;
    internalWrite=false;
    lastValue=payload;
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    if (status && bytes<=MAX_BYTES) {
      status.textContent='Salvando...';
      status.classList.remove('error');
    }
    if (bytes>MAX_BYTES && status) {
      status.textContent=`Anotação com ${Math.ceil(bytes/1024)} KB. O limite do backend é aproximadamente 250 KB; reduza o conteúdo antes de salvar.`;
      status.classList.add('error');
    }
  }

  function insertHtml(html) {
    rich.focus();
    const cleaned=cleanHtml(html);
    if (document.queryCommandSupported?.('insertHTML')) document.execCommand('insertHTML',false,cleaned);
    else {
      const selection=getSelection();
      if (!selection?.rangeCount) {rich.insertAdjacentHTML('beforeend',cleaned);}
      else {
        const range=selection.getRangeAt(0);
        if (!rich.contains(range.commonAncestorContainer)) rich.insertAdjacentHTML('beforeend',cleaned);
        else {range.deleteContents();const frag=range.createContextualFragment(cleaned);range.insertNode(frag);}
      }
    }
    sync();
  }

  toolbar.addEventListener('mousedown',e=>{if(e.target.closest('button[data-command]'))e.preventDefault();});
  toolbar.querySelectorAll('button[data-command]').forEach(b=>b.addEventListener('click',()=>{
    if (textarea.readOnly) return;
    rich.focus();document.execCommand(b.dataset.command,false,null);sync();
  }));
  toolbar.querySelector('#richBlock').addEventListener('change',event=>{
    if (textarea.readOnly) return;
    rich.focus();document.execCommand('formatBlock',false,event.target.value);sync();
  });
  toolbar.querySelector('#richChecklist').onclick=()=>insertHtml('<ul class="rich-checklist"><li><input type="checkbox"> Nova tarefa</li></ul><p><br></p>');
  toolbar.querySelector('#richLink').onclick=()=>{
    if (textarea.readOnly) return;
    const url=prompt('Endereço do link (https://):','https://');
    const safe=safeUrl(url);if(!safe) return;
    const text=getSelection()?.toString().trim() || prompt('Texto do link:','Abrir link') || safe;
    insertHtml(`<a href="${escapeHtml(safe)}">${escapeHtml(text)}</a>`);
  };
  toolbar.querySelector('#richImage').onclick=()=>{
    if (textarea.readOnly) return;
    const url=prompt('Endereço HTTPS da imagem:','https://');
    const safe=safeUrl(url,true);if(!safe) return;
    const alt=prompt('Descrição da imagem (acessibilidade):','Imagem da anotação') || 'Imagem da anotação';
    insertHtml(`<figure><img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(alt)}</figcaption></figure><p><br></p>`);
  };
  toolbar.querySelector('#richTable').onclick=()=>insertHtml('<table><tbody><tr><th>Coluna 1</th><th>Coluna 2</th></tr><tr><td>Dado 1</td><td>Dado 2</td></tr></tbody></table><p><br></p>');
  toolbar.querySelector('#richQuote').onclick=()=>insertHtml('<blockquote class="rich-quote-card">Disciplina hoje é liberdade amanhã.</blockquote><p><br></p>');
  toolbar.querySelector('#richFavorite').onclick=()=>{if(textarea.readOnly)return;savedMetadata.favorite=!savedMetadata.favorite;renderMeta();sync();};
  tags.querySelector('.rich-add-tag').onclick=()=>{
    if (textarea.readOnly || savedMetadata.tags.length>=8) return;
    const tag=prompt('Nome da tag (até 30 caracteres):');
    if (!tag) return;const value=tag.trim().replace(/^#/,'').slice(0,30);
    if (!value || savedMetadata.tags.includes(value)) return;
    savedMetadata.tags.push(value);renderMeta();sync();
  };

  const template=String.raw`<p>Nesta semana, quero manter o foco nas minhas prioridades e equilibrar trabalho, saúde e vida pessoal. Aqui estão as principais tarefas e lembretes:</p>
    <ul class="rich-checklist">
      <li><input type="checkbox" checked> <s>Finalizar o relatório do projeto</s></li>
      <li><input type="checkbox" checked> <s>Enviar e-mails pendentes</s></li>
      <li><input type="checkbox"> Estudar 1 hora por dia</li>
      <li><input type="checkbox"> Fazer exercício físico (mín. 3x na semana)</li>
      <li><input type="checkbox"> Organizar a viagem para o Chile</li>
      <li><input type="checkbox"> Reservar um tempo para leitura</li>
    </ul>
    <div class="rich-media-grid">
      <div class="rich-image-panel"><img src="https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=950&amp;auto=format&amp;fit=crop" alt="Montanhas e lago azul"></div>
      <blockquote class="rich-quote-card">Disciplina hoje é liberdade amanhã.</blockquote>
    </div>
    <h3>Metas da semana</h3>
    <ol class="rich-goals"><li>Avançar no projeto principal</li><li>Manter uma rotina saudável</li><li>Planejar conteúdos para o blog</li><li>Reservar um momento de lazer</li></ol>
    <div class="rich-tip-card">💡 Pequenos passos diários constroem grandes resultados.</div>`;
  toolbar.querySelector('#richTemplate').onclick=()=>{
    if (textarea.readOnly) return;
    if (rich.innerText.trim() && !confirm('Substituir o conteúdo desta nota pelo modelo de planejamento semanal?'))return;
    title.value='Planejamento da semana';title.dispatchEvent(new Event('input',{bubbles:true}));
    rich.innerHTML=cleanHtml(template);
    savedMetadata.tags=['planejamento','rotina','pessoal'];
    renderMeta();sync();
  };

  rich.addEventListener('input',sync);
  rich.addEventListener('change',e=>{
    if(e.target instanceof HTMLInputElement && e.target.type==='checkbox') {
      e.target.toggleAttribute('checked',e.target.checked);
      const li=e.target.closest('li');
      const text=Array.from(li?.children||[]).find(x=>x.tagName==='S');
      if (e.target.checked && !text) {
        const nodes=Array.from(li.childNodes).filter(n=>n!==e.target);
        const s=document.createElement('s'); nodes.forEach(n=>s.appendChild(n));li.append(s);
      }
      if (!e.target.checked && text) text.replaceWith(...text.childNodes);
      sync();
    }
  });
  rich.addEventListener('paste',e=>{
    if (textarea.readOnly) {e.preventDefault();return;}
    const html=e.clipboardData?.getData('text/html');
    const text=e.clipboardData?.getData('text/plain');
    if(html || text) {e.preventDefault();insertHtml(html||plainToHtml(text));}
  });
  rich.addEventListener('drop',e=>e.preventDefault());

  toolbar.querySelector('#richExport').onclick=()=>{
    const safe=cleanHtml(rich.innerHTML);
    const page=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(title.value)}</title><body><h1>${escapeHtml(title.value)}</h1>${safe}</body></html>`;
    const blob=new Blob([page],{type:'text/html;charset=utf-8'});
    const link=document.createElement('a');const url=URL.createObjectURL(blob);
    link.href=url;link.download=(title.value.trim()||'anotacao').replace(/[\\/:*?"<>|]+/g,'-')+'.html';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  // Substitui apenas o download: o save() original ainda recebe textarea.value.
  const oldDownload=document.getElementById('downloadButton');
  if (oldDownload) oldDownload.onclick=()=>toolbar.querySelector('#richExport').click();
  const oldSave=document.getElementById('saveButton');
  oldSave?.setAttribute('title','Salvar anotação formatada no D1');

  // Elementos antigos continuam no DOM; a interface nova é a superfície visível.
  loadFromTextarea(textarea.value);
}
