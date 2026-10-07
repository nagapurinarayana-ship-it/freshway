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
  const image=(type,id)=>media[type]?.[String(id)]||'';
  window.FreshWayCatalogueMedia=Object.freeze({image});
})();
