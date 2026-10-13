/* Complemento visual: não altera Firebase nem chama endpoints privados. */
const app = document.getElementById('appView');
const login = document.getElementById('loginView');
const background = document.querySelector('.app-background');
if(app && login && background) {
  app.classList.add('dashboard-shell');
  // O mesmo desenho SVG do login fica atrás do aplicativo, sem recriar o cenário.
  const art = login.querySelector('.login-art');
  if(art) {
    const shared = art.cloneNode(true);
    shared.classList.add('dashboard-backdrop-art');
    shared.setAttribute('aria-hidden','true');
    background.append(shared);
    const style=document.createElement('style');
    style.textContent=`.app-background .dashboard-backdrop-art{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}body:has(#appView:not([hidden])){background:linear-gradient(130deg,#84c5ff,#4da3ff 30%,#0d67dd 67%,#053895)!important}body:has(#appView:not([hidden])) .app-background::before,body:has(#appView:not([hidden])) .app-background::after{display:none}`;
    document.head.append(style);
  }
  const header=app.querySelector('.topbar');
  const right=header?.querySelector('.topbar-right');
  if(header && right) {
    const box=document.createElement('label');
    box.className='global-search-box';
    box.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="6.5" stroke="currentColor" stroke-width="1.8"/><path d="m15 15 5 5" stroke="currentColor" stroke-width="1.8"/></svg><input type="search" placeholder="Buscar em todas as anotações..." aria-label="Buscar em todas as anotações"><kbd>⌘ K</kbd>';
    header.insertBefore(box,right);
    const input=box.querySelector('input');
    // A pesquisa usa o filtro já existente da seção, sem sugerir uma busca global falsa.
    input.placeholder='Buscar nesta seção...';
    input.addEventListener('input',()=>{const old=document.getElementById('searchInput');if(old){old.value=input.value;old.dispatchEvent(new Event('input',{bubbles:true}));}});
    document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();input.focus();}});
    const cloud=document.createElement('span');
    cloud.className='dashboard-cloud';cloud.textContent='● Conectando...';
    right.insertBefore(cloud,right.firstChild);
    const bar=document.getElementById('statusBar');
    if(bar){const sync=()=>{const t=bar.textContent||'';cloud.textContent=/erro|falha|não foi possível/i.test(t)?'● Erro ao salvar':/não salvo|salvando/i.test(t)?'● Salvando...':/conectado|salva|carregado|criados/i.test(t)?'● Sincronizado':'● Conectando...';cloud.classList.toggle('error',/erro|falha|não foi possível/i.test(t));};new MutationObserver(sync).observe(bar,{childList:true,characterData:true,subtree:true});sync();}
    const email=document.getElementById('accountEmail');
    if(email){
      // O app.js original atualiza #accountEmail; mantemos esse elemento no DOM.
      email.style.display='none';
      const details=document.createElement('span');details.className='account-details';
      const name=document.createElement('strong');const small=document.createElement('small');
      details.append(name,small);right.insertBefore(details,email);
      const avatar=document.createElement('span');avatar.className='profile-avatar';avatar.textContent='U';right.insertBefore(avatar,details);
      const update=()=>{const address=email.textContent||'';small.textContent=address;name.textContent=address.split('@')[0]||'Minha conta';avatar.textContent=(name.textContent[0]||'U').toUpperCase();};
      new MutationObserver(update).observe(email,{childList:true,characterData:true,subtree:true});update();
    }
  }
  const sections=document.getElementById('sectionsList');
  if(sections){const customize=()=>{sections.querySelectorAll('.list-item').forEach((item,i)=>{const ico=item.querySelector('.item-icon');if(ico&&!ico.querySelector('.section-color')){ico.replaceChildren();const p=document.createElement('span');p.className='section-color color-'+i%8;ico.append(p);}});};new MutationObserver(customize).observe(sections,{childList:true});customize();}
}
