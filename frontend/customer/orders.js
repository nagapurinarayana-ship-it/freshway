// Customer orders boundary.
// Keeps order normalization/rendering helpers isolated from checkout and catalogue code.
(function(){
  const normalize=list=>Array.isArray(list)?list.filter(Boolean):[];
  const latest=list=>normalize(list)[0]||null;
  const statusLabel=status=>({New:'New',Confirmed:'Confirmed',Processing:'Processing',Ready:'Ready',Out:'Out for Delivery',Delivered:'Delivered',Cancelled:'Cancelled',Ordered:'New'})[status]||String(status||'New');
  window.FreshWayCustomerOrders=Object.freeze({normalize,latest,statusLabel});
})();
