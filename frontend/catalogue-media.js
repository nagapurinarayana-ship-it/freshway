(function(){
  const BASE='frontend/media/catalogue/';
  const media=Object.freeze({
    categories:Object.freeze({
      'cat-oils':BASE+'groundnut-oil.svg',
      'cat-rice':BASE+'hmt-rice.svg'
    }),
    products:Object.freeze({
      'p-1788808795819-x0yy':BASE+'groundnut-oil.svg',
      'p-mtsy8sib-wdsit':BASE+'sunflower-oil.svg',
      'p-mtsy9yvt-ca3c5':BASE+'hmt-rice.svg',
      'p-mtsyafsh-82by2':BASE+'sona-masuri.svg'
    })
  });
  const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('en-IN').replace(/[^a-z0-9]+/g,' ').trim();
  const categoryByKey=Object.freeze({
    'oil':BASE+'groundnut-oil.svg',
    'oils':BASE+'groundnut-oil.svg',
    'cooking oil':BASE+'groundnut-oil.svg',
    'cooking oils':BASE+'groundnut-oil.svg',
    'rice':BASE+'hmt-rice.svg'
  });
  const productByName=name=>{
    const key=normalize(name).replace(/\\bground\\s+nut\\b/g,'groundnut');
    if(key.includes('groundnut'))return BASE+'groundnut-oil.svg';
    if(key.includes('sunflower'))return BASE+'sunflower-oil.svg';
    if(key.includes('hmt')&&key.includes('rice'))return BASE+'hmt-rice.svg';
    if(key.includes('sona')&&key.includes('masuri'))return BASE+'sona-masuri.svg';
    return '';
  };
  const image=(type,id,entity)=>{
    const known=media[type]?.[String(id)];
    if(known)return known;
    if(type==='categories'){
      const slug=normalize(entity?.slug);
      const name=normalize(entity?.name);
      return categoryByKey[slug]||categoryByKey[name]||'';
    }
    if(type==='products')return productByName(entity?.name);
    return '';
  };
  window.FreshWayCatalogueMedia=Object.freeze({image});
})();
