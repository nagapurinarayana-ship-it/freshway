import { json } from './admin-shared.js';
import { orders, updateOrder } from './admin-orders.js';
import { customers, customer } from './admin-customers.js';
import { summary, reports } from './admin-reports.js';
import { deleteProduct } from './admin-products.js';

// Route table is intentionally kept small: authentication/routing lives in admin-auth.js;
// domain behavior lives in one feature module per resource.
const routes = [
  { match: (u,m) => u.pathname === '/api/admin/summary' && m === 'GET', run: (r,e,u) => summary(e,u) },
  { match: (u,m) => u.pathname === '/api/admin/reports' && m === 'GET', run: (r,e,u) => reports(e,u) },
  { match: (u,m) => u.pathname === '/api/admin/orders' && m === 'GET', run: (r,e,u) => orders(e,u) },
  { match: (u,m) => u.pathname.startsWith('/api/admin/orders/') && m === 'PATCH', run: async (r,e,u) => updateOrder(e,decodeURIComponent(u.pathname.split('/').pop()),await r.json()) },
  { match: (u,m) => u.pathname === '/api/admin/customers' && m === 'GET', run: (r,e,u) => customers(e,u) },
  { match: (u,m) => u.pathname.startsWith('/api/admin/customers/') && m === 'GET', run: (r,e,u) => customer(e,decodeURIComponent(u.pathname.split('/').pop())) },
  { match: (u,m) => u.pathname.startsWith('/api/admin/products/') && m === 'DELETE', run: (r,e,u) => deleteProduct(e,decodeURIComponent(u.pathname.split('/').pop())) }
];

export async function handleAdminData(request,env){const u=new URL(request.url);try{const route=routes.find(x=>x.match(u,request.method));return route?json(await route.run(request,env,u)):null}catch(e){return json({error:e?.message||'Admin data request failed.'},400)}}