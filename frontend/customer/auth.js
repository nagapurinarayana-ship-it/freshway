// Customer authentication boundary.
// Keeps secure session/login/logout access behind one stable customer-facing contract.
(function(){
  const service=()=>window.FreshWayNotifications;
  const session=()=>service().session();
  const login=()=>service().login();
  const ensureAuthenticated=phone=>service().ensureAuthenticated(phone);
  const logout=()=>service().logout();
  const customerId=()=>service().customerId();
  const registeredPhone=()=>service().registeredPhone?.()||'';
  const registeredName=()=>service().registeredName?.()||'';
  window.FreshWayCustomerAuth=Object.freeze({session,login,ensureAuthenticated,logout,customerId,registeredPhone,registeredName});
})();
