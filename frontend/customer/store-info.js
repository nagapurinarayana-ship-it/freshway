(function(){
  let lastProfile=null;
  const q=id=>document.getElementById(id);
  const text=(id,value,fallback='')=>{const el=q(id);if(el)el.textContent=String(value||fallback);return el};
  const clean=value=>String(value||'').trim();
  const digits=value=>clean(value).replace(/\D/g,'');
  const telHref=value=>{const d=digits(value);return d?'tel:+'+(d.length===10?'91':'')+d:''};
  const waHref=value=>{const d=digits(value);return d?'https://wa.me/'+(d.length===10?'91'+d:d):''};
  const mailHref=value=>{const e=clean(value);return/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)?'mailto:'+e:''};
  const validShopCoordinates=(latitude,longitude)=>{
    if(latitude==null||latitude===''||longitude==null||longitude==='')return false;
    const lat=Number(latitude),lon=Number(longitude);
    return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180&&!(lat===0&&lon===0);
  };
  const mapHref=(address,latitude,longitude)=>{
    if(validShopCoordinates(latitude,longitude))return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(Number(latitude)+','+Number(longitude));
    const a=clean(address);
    return a?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(a):'';
  };

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
      const hasShopPin=validShopCoordinates(profile.shopLatitude,profile.shopLongitude);
      const map=action(
        hasShopPin?'Get directions':'Open in Maps',
        profile.address,
        mapHref(profile.address,profile.shopLatitude,profile.shopLongitude),
        '🗺️',
        'store-map-action'
      );
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

  async function renderContact(profile,api,toast){
    const root=q('contactContent');if(!root)return;
    root.replaceChildren();
    const name=clean(profile.storeName)||'FreshWay';
    text('contactTitle','Contact Us');
    intro(root,'GET IN TOUCH','Reach FreshWay','Choose the quickest way to get in touch, or send us a message here.');
    const actions=document.createElement('div');actions.className='store-action-grid store-contact-actions';
    [['Call',profile.phone,telHref(profile.phone),'☎️'],['WhatsApp',profile.whatsapp||profile.phone,waHref(profile.whatsapp||profile.phone),'💬'],['Email',profile.email,mailHref(profile.email),'✉️']].forEach(x=>{
      const a=action(x[0],x[1],x[2],x[3]);if(a)actions.appendChild(a);
    });
    if(actions.children.length)root.appendChild(actions);
    const formSection=document.createElement('section');formSection.className='fw-customer-message-compose';
    formSection.innerHTML='<div class="fw-customer-message-compose-head"><span class="eyebrow">MESSAGE US</span><h2>Send a message</h2><p>We’ll reply in FreshWay. Open Profile → Messages to read our response.</p></div><form data-customer-message-form><label>Subject<input name="subject" required minlength="3" maxlength="120" autocomplete="off" placeholder="e.g. Product question"></label><label>Your message<textarea name="message" required minlength="5" maxlength="2000" rows="4" placeholder="Tell us how we can help (max 2,000 characters)"></textarea></label><p class="fw-customer-message-form-status" data-compose-status role="status" aria-live="polite"></p><button class="primary-btn full" type="submit" data-compose-submit>Send message</button></form><button class="text-btn" type="button" data-compose-messages>View messages and replies →</button>';
    root.appendChild(formSection);
    const form=formSection.querySelector('[data-customer-message-form]'),submit=formSection.querySelector('[data-compose-submit]'),status=formSection.querySelector('[data-compose-status]');
    const setStatus=(message,isError=false)=>{status.textContent=message;status.classList.toggle('is-error',isError);};
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!api){setStatus('Messaging is temporarily unavailable. Please use Call or WhatsApp.',true);return;}
      const subject=String(form.elements.subject.value||'').trim(),message=String(form.elements.message.value||'').trim();
      if(subject.length<3||message.length<5){setStatus('Add a subject and a message with at least 5 characters.',true);return;}
      submit.disabled=true;setStatus('Sending your message…');
      try{
        const options={method:'POST',body:JSON.stringify({subject,message})};
        let result;
        try{result=await api('/api/customer/messages',options);}
        catch(error){
          if(Number(error?.status)!==401)throw error;
          await window.FreshWayCustomerAuth?.login?.();
          result=await api('/api/customer/messages',options);
        }
        form.reset();
        setStatus(result.message||'Message sent. We’ll reply in Profile → Messages.');
        window.FreshWayCustomerMessages?.refreshBadge?.();
        if(typeof toast==='function')toast('Message sent to FreshWay');
      }catch(error){setStatus(error.message||'Could not send your message. Please try again.',true);}
      finally{submit.disabled=false;}
    });
    formSection.querySelector('[data-compose-messages]').addEventListener('click',()=>window.setView?.('messages'));
    const stylesId='fw-customer-message-compose-styles';
    if(!document.getElementById(stylesId)){
      const style=document.createElement('style');style.id=stylesId;
      style.textContent='.fw-customer-message-compose{margin:18px 0;padding:18px;border:1px solid #e1e9e4;border-radius:18px;background:#fff}.fw-customer-message-compose-head h2{margin:6px 0}.fw-customer-message-compose-head p{color:#647168;margin:0 0 14px}.fw-customer-message-compose form{display:grid;gap:12px}.fw-customer-message-compose label{display:grid;gap:6px;font-weight:600}.fw-customer-message-compose input,.fw-customer-message-compose textarea{width:100%;box-sizing:border-box;border:1px solid #d8e2dc;border-radius:10px;padding:12px;font:inherit;font-weight:400;background:#fff}.fw-customer-message-compose textarea{resize:vertical}.fw-customer-message-form-status{min-height:1.3em;margin:0;color:#176b43;font-size:.92rem}.fw-customer-message-form-status.is-error{color:#a12b2b}.fw-customer-message-compose button:disabled{opacity:.65}';
      document.head.appendChild(style);
    }
    const hint=document.createElement('a');hint.className='store-contact-note';hint.href='#';
    hint.innerHTML='<strong>Need store details?</strong><p>View the address, business hours and delivery information.</p><span>About FreshWay →</span>';
    hint.onclick=e=>{e.preventDefault();window.setView?.('about');};
    root.appendChild(hint);
    if(!actions.children.length)root.insertBefore(infoSection('CONTACT','Contact information will appear here once the store profile is completed.','☎️'),formSection);
  }

  async function show(name,{api,toast}){
    const data=await api('/api/store-profile');
    const profile=data?.storeProfile||{};
    lastProfile=profile;
    if(name==='about')renderAbout(profile);
    if(name==='contact')await renderContact(profile,api,toast);
    return profile;
  }

  window.FreshWayCustomerStoreInfo=Object.freeze({show,renderAbout,renderContact,mapHref,validShopCoordinates,get lastProfile(){return lastProfile;}});
})();