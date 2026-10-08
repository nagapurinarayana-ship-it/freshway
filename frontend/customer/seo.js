const FreshWaySeo=(()=>{
  const siteUrl='https://freshway-f32.pages.dev/';
  const publicTitle='FreshWay | Fresh Groceries & Everyday Essentials Delivered Locally';
  const publicDescription='Shop fresh fruits, groceries and everyday essentials from FreshWay. Order online for local delivery with convenient cash payment.';
  const publicImage=siteUrl+'icons/icon-512.png';
  const privateViews=new Set(['cart','checkout','orders','profile']);

  const upsert=(selector,attributes)=>{
    let el=document.head.querySelector(selector);
    if(!el){el=document.createElement('meta');document.head.appendChild(el)}
    Object.entries(attributes).forEach(([key,value])=>el.setAttribute(key,value));
    return el;
  };

  const canonical=()=>{
    let el=document.head.querySelector('link[rel="canonical"]');
    if(!el){el=document.createElement('link');el.rel='canonical';document.head.appendChild(el)}
    el.href=siteUrl;
  };

  const setStructuredData=()=>{
    if(document.head.querySelector('#freshway-seo-schema'))return;
    const script=document.createElement('script');
    script.id='freshway-seo-schema';
    script.type='application/ld+json';
    script.textContent=JSON.stringify({
      '@context':'https://schema.org',
      '@graph':[
        {
          '@type':'Organization',
          '@id':siteUrl+'#organization',
          name:'FreshWay',
          url:siteUrl,
          logo:publicImage
        },
        {
          '@type':'WebSite',
          '@id':siteUrl+'#website',
          name:'FreshWay',
          url:siteUrl,
          publisher:{'@id':siteUrl+'#organization'},
          inLanguage:'en-IN'
        },
        {
          '@type':'WebPage',
          '@id':siteUrl+'#webpage',
          url:siteUrl,
          name:publicTitle,
          description:publicDescription,
          isPartOf:{'@id':siteUrl+'#website'},
          about:{'@id':siteUrl+'#organization'},
          inLanguage:'en-IN',
          primaryImageOfPage:{'@type':'ImageObject',url:publicImage}
        }
      ]
    });
    document.head.appendChild(script);
  };

  const setView=(view)=>{
    const isPrivate=privateViews.has(view);
    document.title=isPrivate?'FreshWay | '+view.charAt(0).toUpperCase()+view.slice(1):publicTitle;
    upsert('meta[name="description"]',{name:'description',content:isPrivate?'FreshWay customer account and ordering area.':publicDescription});
    upsert('meta[name="robots"]',{name:'robots',content:isPrivate?'noindex,follow':'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'});
    upsert('meta[property="og:title"]',{property:'og:title',content:document.title});
    upsert('meta[property="og:description"]',{property:'og:description',content:isPrivate?'FreshWay customer account and ordering area.':publicDescription});
    upsert('meta[property="og:url"]',{property:'og:url',content:siteUrl});
    upsert('meta[property="og:type"]',{property:'og:type',content:'website'});
    upsert('meta[property="og:site_name"]',{property:'og:site_name',content:'FreshWay'});
    upsert('meta[property="og:image"]',{property:'og:image',content:publicImage});
    upsert('meta[property="og:image:alt"]',{property:'og:image:alt',content:'FreshWay — Fresh groceries and everyday essentials delivered locally.'});
    upsert('meta[property="og:image:type"]',{property:'og:image:type',content:'image/png'});
    upsert('meta[property="og:locale"]',{property:'og:locale',content:'en_IN'});
    upsert('meta[name="twitter:card"]',{name:'twitter:card',content:'summary'});
    upsert('meta[name="twitter:title"]',{name:'twitter:title',content:document.title});
    upsert('meta[name="twitter:description"]',{name:'twitter:description',content:isPrivate?'FreshWay customer account and ordering area.':publicDescription});
    upsert('meta[name="twitter:image"]',{name:'twitter:image',content:publicImage});
    canonical();
  };

  const init=()=>{
    setStructuredData();
    setView('home');
  };

  return Object.freeze({init,setView});
})();

window.FreshWaySeo=FreshWaySeo;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>FreshWaySeo.init(),{once:true});else FreshWaySeo.init();
