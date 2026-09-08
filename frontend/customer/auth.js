// Customer authentication boundary.
// Keeps secure session/login/logout access behind one stable customer-facing contract.
(function(){
  const service=()=>window.FreshWayNotifications;
  const session=()=>service().session();
  const login=()=>service().login();
  const ensureAuthenticated=phone=>service().ensureAuthenticated(phone);
  const logout=()=>service().logout();
  const customerId=()=>service().customerId();
  window.FreshWayCustomerAuth=Object.freeze({session,login,ensureAuthenticated,logout,customerId});
})();
