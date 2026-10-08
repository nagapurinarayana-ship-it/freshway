(function(){
  let lastProfile=null;
  const q=id=>document.getElementById(id);
  const text=(id,value,fallback='')=>{const el=q(id);if(el)el.textContent=String(value||fallback);return el};
  const clean=value=>String(value||'').trim();
  const digits=value=>clean(value).replace(/\D/g,'');
  const telHref=value=>{const d=digits(value);return d?'tel:+'+(d.length===10?'91':'')+d:''};
  const waHref=value=>{const d=digits(value);return d?'https://wa.me/'+(d.length===10?'91'+d:d):''};
  const mailHref=value=>{const e=clean(value);return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?'mailto:'+e:''};
  const mapHref=value=>{const a=clean(value);return a?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(a):''};

  function action(label,value,href,icon,extra=''){
    if(!href)return null;
    const a=document.createElement('a');a.className='store-action '+extra;a.href=href;
    if(href.startsWith('https://')){a.target='_blank';a.rel='noopener noreferrer';}
    a.innerHTML='<span class="store-action-icon" aria-hidden="true">'+icon+'</span><span class="store-action-copy"><strong></strong><small></small></span><span class="store-action-arrow" aria-hidden="true">›</span>';
    a.querySelector('strong').textContent=label;
    a.querySelector('small').textContent=value||'';
    return a;
  }

  function infoSection(label,value,icon,extra=''){
    const v=clean(value);if(!v)return null;
    const card=document.createElement('article');card.className='store-info-section '+extra;
    card.innerHTML='<div class="store-info-section-head"><span class="store-info-icon" aria-hidden="true"></span><div><span class="eyebrow"></span><p></p></div></div>';
    card.querySelector('.store-info-icon').textContent=icon;
    card.querySelector('.eyebrow').textContent=label;
    card.querySelector('p').textContent=v;
    return card;
  }

  function intro(root,kicker,title,description){
    const el=document.createElement('div');el.className='store-page-intro';
    el.innerHTML='<span class="eyebrow"></span><h1></h1><p></p>';
    el.querySelector('.eyebrow').textContent=kicker;
    el.querySelector('h1').textContent=title;
    el.querySelector('p').textContent=description;
    root.appendChild(el);
  }

  function brandHero(root,name){
    const hero=document.createElement('section');hero.className='store-about-hero';
    hero.innerHTML='<img class="store-about-logo" alt=""><div><span class="eyebrow">FRESHWAY</span><h2></h2><p>Fresh groceries & everyday essentials</p></div>';
    const img=hero.querySelector('img');img.src='freshway-logo-master.webp?v=20261008-master-v1';img.alt=name+' logo';
    hero.querySelector('h2').textContent=name;
    root.appendChild(hero);
  }

  function renderAbout(profile){
    const root=q('aboutContent');if(!root)return;
    root.replaceChildren();
    const name=clean(profile.storeName)||'FreshWay';
    text('aboutTitle','About '+name);
    intro(root,'OUR STORE',name,'Everything customers need to know before placing an order.');
    brandHero(root,name);

    root.appendChild(
      infoSection(
        'ABOUT FRESHWAY',
        clean(profile.about)||('Welcome to '+name+'. Shop fresh groceries and everyday essentials through the FreshWay app.'),
        '🥬',
        'store-info-about'
      )
    );

    const details=document.createElement('div');details.className='store-info-grid';
    const address=infoSection('BUSINESS ADDRESS',profile.address,'📍','store-info-address');
    if(address){
      const map=action('Open in Maps',profile.address,mapHref(profile.address),'🗺️','store-map-action');
      if(map)address.appendChild(map);
      details.appendChild(address);
    }
    [['BUSINESS HOURS',profile.businessHours,'🕒'],['DELIVERY INFORMATION',profile.deliveryInfo,'🚚']].forEach(x=>{
      const c=infoSection(x[0],x[1],x[2]);if(c)details.appendChild(c);
    });
    if(details.children.length)root.appendChild(details);

    const contactLink=document.createElement('a');contactLink.className='store-contact-cta';contactLink.href='#';
    contactLink.textContent='Need help? Contact FreshWay →';
    contactLink.onclick=e=>{e.preventDefault();window.setView?.('contact');};
    root.appendChild(contactLink);
  }

  function renderContact(profile){
    const root=q('contactContent');if(!root)return;
    root.replaceChildren();
    const name=clean(profile.storeName)||'FreshWay';
    text('contactTitle','Contact Us');
    intro(root,'GET IN TOUCH','Contact FreshWay','Choose the quickest way to reach us.');
    const actions=document.createElement('div');actions.className='store-action-grid store-contact-actions';
    [['Call',profile.phone,telHref(profile.phone),'☎️'],['WhatsApp',profile.whatsapp||profile.phone,waHref(profile.whatsapp||profile.phone),'💬'],['Email',profile.email,mailHref(profile.email),'✉️']].forEach(x=>{
      const a=action(x[0],x[1],x[2],x[3]);if(a)actions.appendChild(a);
    });
    if(actions.children.length)root.appendChild(actions);
    const hint=document.createElement('div');hint.className='store-contact-note';
    hint.innerHTML='<strong>Business details</strong><p>Address, hours and delivery information are available on <button type="button">About FreshWay</button>.</p>';
    hint.querySelector('button').onclick=()=>window.setView?.('about');
    root.appendChild(hint);
    if(!actions.children.length)root.appendChild(infoSection('CONTACT','Contact information will appear here once the store profile is completed.','☎️'));
  }

  async function show(name,{api}){
    const data=await api('/api/store-profile');
    const profile=data?.storeProfile||{};
    lastProfile=profile;
    if(name==='about')renderAbout(profile);
    if(name==='contact')renderContact(profile);
    return profile;
  }

  window.FreshWayCustomerStoreInfo=Object.freeze({show,renderAbout,renderContact,get lastProfile(){return lastProfile;}});
})();