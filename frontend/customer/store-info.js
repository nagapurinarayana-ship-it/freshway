(function(){
  let lastProfile=null;
  const q=id=>document.getElementById(id);
  const text=(id,value,fallback='')=>{const el=q(id);if(el)el.textContent=String(value||fallback);return el};
  const digits=value=>String(value||'').replace(/\D/g,'');
  const telHref=value=>{const d=digits(value);return d?'tel:+'+(d.length===10?'91':'')+d:''};
  const waHref=value=>{const d=digits(value);if(!d)return'';return'https://wa.me/'+(d.length===10?'91'+d:d)};
  const mailHref=value=>{const email=String(value||'').trim();return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?'mailto:'+email:''};
  const mapHref=value=>{const address=String(value||'').trim();return address?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address):''};

  function card(label,value,emoji){
    if(!String(value||'').trim())return null;
    const article=document.createElement('article');article.className='info-card';
    const eyebrow=document.createElement('span');eyebrow.className='eyebrow';eyebrow.textContent=(emoji?emoji+' ':'')+label.toUpperCase();
    const body=document.createElement('p');body.textContent=String(value).trim();
    article.append(eyebrow,body);
    return article;
  }
  function action(label,href){
    if(!href)return null;
    const a=document.createElement('a');a.className='info-action';a.href=href;a.textContent=label;
    if(href.startsWith('https://')){a.target='_blank';a.rel='noopener noreferrer';}
    return a;
  }
  function renderAbout(profile){
    const root=q('aboutContent');if(!root)return;
    root.replaceChildren();
    text('aboutTitle','About '+(profile.storeName||'FreshWay'));
    const primary=card('About',profile.about,'ℹ️');
    if(primary){
      primary.classList.add('info-card-primary');
      const heading=document.createElement('h2');heading.textContent=profile.storeName||'FreshWay';
      primary.insertBefore(heading,primary.querySelector('p'));
      root.appendChild(primary);
    }else{
      root.appendChild(card('FreshWay','FreshWay information will appear here once the store profile is completed.','ℹ️'));
    }
    for(const item of [['Delivery',profile.deliveryInfo,'🚚'],['Business hours',profile.businessHours,'🕒']]){
      const extra=card(item[0],item[1],item[2]);if(extra)root.appendChild(extra);
    }
  }
  function renderContact(profile){
    const root=q('contactContent');if(!root)return;
    root.replaceChildren();
    text('contactTitle','Contact Us');
    const actions=document.createElement('div');actions.className='info-actions';
    for(const item of [['Call',telHref(profile.phone)],['WhatsApp',waHref(profile.whatsapp||profile.phone)],['Email',mailHref(profile.email)]]){
      const link=action(item[0],item[1]);if(link)actions.appendChild(link);
    }
    if(actions.children.length)root.appendChild(actions);
    const address=card('Business address',profile.address,'📍');
    if(address){
      const link=action('Open in Maps →',mapHref(profile.address));
      if(link)address.appendChild(link);
      root.appendChild(address);
    }
    for(const item of [['Business hours',profile.businessHours,'🕒'],['Delivery information',profile.deliveryInfo,'🚚']]){
      const extra=card(item[0],item[1],item[2]);if(extra)root.appendChild(extra);
    }
    if(!root.children.length)root.appendChild(card('Contact Us','Contact information will appear here once the store profile is completed.','☎️'));
  }
  async function show(name,{api}){
    const data=await api('/store-profile');
    const profile=data?.storeProfile||{};
    lastProfile=profile;
    if(name==='about')renderAbout(profile);
    if(name==='contact')renderContact(profile);
    return profile;
  }
  window.FreshWayCustomerStoreInfo=Object.freeze({show,renderAbout,renderContact,get lastProfile(){return lastProfile;}});
})();
