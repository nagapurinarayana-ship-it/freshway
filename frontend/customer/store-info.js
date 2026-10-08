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

  function action(label,value,href,icon){
    if(!href)return null;
    const a=document.createElement('a');a.className='store-action';a.href=href;
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

  function renderAbout(profile){
    const root=q('aboutContent');if(!root)return;
    root.replaceChildren();
    const name=clean(profile.storeName)||'FreshWay';
    text('aboutTitle','About '+name);
    intro(root,'OUR STORE',name,'Fresh groceries and everyday essentials, delivered locally.');
    root.appendChild(infoSection('ABOUT FRESHWAY',clean(profile.about)||('Welcome to '+name+'. Shop fresh groceries and everyday essentials through the FreshWay app.'),'🥬','store-info-about'));
    const details=document.createElement('div');details.className='store-info-grid';
    [['DELIVERY',profile.deliveryInfo,'🚚'],['BUSINESS HOURS',profile.businessHours,'🕒']].forEach(x=>{const c=infoSection(x[0],x[1],x[2]);if(c)details.appendChild(c)});
    if(details.children.length)root.appendChild(details);
  }

  function renderProfileSummary(profile){
    const root=q('customerStoreProfileSummary');if(!root)return;
    root.replaceChildren();
    const name=clean(profile.storeName)||'FreshWay';
    const header=document.createElement('div');header.className='store-summary-header';
    header.innerHTML='<div class="store-summary-mark">FW</div><div><span class="eyebrow">LOCAL STORE</span><h2></h2><p>Fresh groceries & everyday essentials</p></div>';
    header.querySelector('h2').textContent=name;
    root.appendChild(header);
    const actions=document.createElement('div');actions.className='store-action-grid';
    [['Call',profile.phone,telHref(profile.phone),'☎️'],['WhatsApp',profile.whatsapp||profile.phone,waHref(profile.whatsapp||profile.phone),'💬'],['Email',profile.email,mailHref(profile.email),'✉️']].forEach(x=>{const a=action(x[0],x[1],x[2],x[3]);if(a)actions.appendChild(a)});
    if(actions.children.length)root.appendChild(actions);
    const details=document.createElement('div');details.className='store-summary-details';
    [['Address',profile.address,'📍'],['Hours',profile.businessHours,'🕒'],['Delivery',profile.deliveryInfo,'🚚']].forEach(x=>{const c=infoSection(x[0],x[1],x[2]);if(c)details.appendChild(c)});
    if(details.children.length)root.appendChild(details);
    root.classList.toggle('hidden',root.children.length===0);
  }

  function renderContact(profile){
    const root=q('contactContent');if(!root)return;
    root.replaceChildren();
    const name=clean(profile.storeName)||'FreshWay';
    text('contactTitle','Contact '+name);
    intro(root,'GET IN TOUCH','We’re here to help','Reach FreshWay directly or find our business location.');
    const actions=document.createElement('div');actions.className='store-action-grid store-contact-actions';
    [['Call',profile.phone,telHref(profile.phone),'☎️'],['WhatsApp',profile.whatsapp||profile.phone,waHref(profile.whatsapp||profile.phone),'💬'],['Email',profile.email,mailHref(profile.email),'✉️']].forEach(x=>{const a=action(x[0],x[1],x[2],x[3]);if(a)actions.appendChild(a)});
    if(actions.children.length)root.appendChild(actions);
    const address=infoSection('BUSINESS ADDRESS',profile.address,'📍','store-info-address');
    if(address){const map=action('Open in Maps',profile.address,mapHref(profile.address),'🗺️');if(map){map.classList.add('store-map-action');address.appendChild(map)}root.appendChild(address);}
    const details=document.createElement('div');details.className='store-info-grid';
    [['BUSINESS HOURS',profile.businessHours,'🕒'],['DELIVERY INFORMATION',profile.deliveryInfo,'🚚']].forEach(x=>{const c=infoSection(x[0],x[1],x[2]);if(c)details.appendChild(c)});
    if(details.children.length)root.appendChild(details);
    if(!root.children.length)root.appendChild(infoSection('CONTACT','Contact information will appear here once the store profile is completed.','☎️'));
  }

  async function show(name,{api}){
    const data=await api('/api/store-profile');
    const profile=data?.storeProfile||{};
    lastProfile=profile;
    renderProfileSummary(profile);
    if(name==='about')renderAbout(profile);
    if(name==='contact')renderContact(profile);
    return profile;
  }

  window.FreshWayCustomerStoreInfo=Object.freeze({show,renderAbout,renderContact,renderProfileSummary,get lastProfile(){return lastProfile;}});
})();