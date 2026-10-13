import { getApps } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";

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
      // Identidade obtida do Firebase Auth (não deduzida do e-mail).
      email.style.display='none';
      const details=document.createElement('span');
      details.className='account-details';
      const name=document.createElement('strong');
      const small=document.createElement('small');
      details.append(name,small);
      right.insertBefore(details,email);

      const avatar=document.createElement('span');
      avatar.className='profile-avatar';
      const avatarImage=document.createElement('img');
      avatarImage.alt='Foto do perfil';
      avatarImage.referrerPolicy='no-referrer';
      avatarImage.hidden=true;
      const initials=document.createElement('span');
      initials.textContent='U';
      avatar.append(avatarImage,initials);
      right.insertBefore(avatar,details);

      function showProfile(user){
        const google=user?.providerData?.find(p=>p.providerId==='google.com');
        const address=(user?.email || google?.email || '').trim();
        const googleName=(user?.displayName || google?.displayName || '').trim();
        const fallback=address.split('@')[0]?.replace(/[._-]+/g,' ').trim() || 'Minha conta';
        const displayName=googleName || fallback;
        name.textContent=displayName;
        small.textContent=address;
        initials.textContent=displayName.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase() || 'U';
        initials.hidden=false;
        avatarImage.hidden=true;

        const photo=user?.photoURL || google?.photoURL || '';
        let safePhoto='';
        try {
          const parsed=new URL(photo);
          if(parsed.protocol==='https:') safePhoto=parsed.href;
        }catch{/* Sem foto válida; permanecem as iniciais. */}
        if(safePhoto){
          avatarImage.onload=()=>{
            avatarImage.hidden=false;
            initials.hidden=true;
          };
          avatarImage.onerror=()=>{
            avatarImage.hidden=true;
            initials.hidden=false;
          };
          avatarImage.src=safePhoto;
        }else{
          avatarImage.removeAttribute('src');
        }
      }

      const firebaseApp=getApps().find(item=>item.options.projectId==='mynotes-auth-af57d');
      if(firebaseApp){
        onAuthStateChanged(getAuth(firebaseApp),showProfile);
      }else{
        console.warn('Firebase não inicializado ao carregar o dashboard.');
      }
    }
  }
  const sections=document.getElementById('sectionsList');
  if(sections){const customize=()=>{sections.querySelectorAll('.list-item').forEach((item,i)=>{const ico=item.querySelector('.item-icon');if(ico&&!ico.querySelector('.section-color')){ico.replaceChildren();const p=document.createElement('span');p.className='section-color color-'+i%8;ico.append(p);}});};new MutationObserver(customize).observe(sections,{childList:true});customize();}
}
