import { json } from './admin-shared.js';
import { orders, updateOrder } from './admin-orders.js';
import { customers, customer } from './admin-customers.js';
import { summary, reports } from './admin-reports.js';
import { deleteProduct } from './admin-products.js';
import { getStoreProfile, updateStoreProfile } from './store-profile.js';
import { getInvoiceSettings, updateInvoiceSettings, backfillMissingInvoices } from './invoice-service.js';
import { handleAdminDeliveryRequest } from './delivery-scheduling.js';
import { handleAdminCustomerMessages } from './customer-messages.js';
import { handleAdminDeliveryOffersRequest } from './delivery-offers.js';

// Route table is intentionally kept small: authentication/routing lives in admin-auth.js;
// domain behavior lives in one feature module per resource.
const routes = [
  { match: (u,m) => u.pathname === '/api/admin/summary' && m === 'GET', run: (r,e,u) => summary(e,u) },
  { match: (u,m) => u.pathname === '/api/admin/reports' && m === 'GET', run: (r,e,u) => reports(e,u) },
  { match: (u,m) => u.pathname === '/api/admin/orders' && m === 'GET', run: (r,e,u) => orders(e,u) },
  { match: (u,m) => u.pathname.startsWith('/api/admin/orders/') && m === 'PATCH', run: async (r,e,u) => updateOrder(e,decodeURIComponent(u.pathname.split('/').pop()),await r.json()) },
  { match: (u,m) => u.pathname === '/api/admin/customers' && m === 'GET', run: (r,e,u) => customers(e,u) },
  { match: (u,m) => u.pathname.startsWith('/api/admin/customers/') && m === 'GET', run: (r,e,u) => customer(e,decodeURIComponent(u.pathname.split('/').pop())) },
  { match: (u,m) => u.pathname.startsWith('/api/admin/products/') && m === 'DELETE', run: (r,e,u) => deleteProduct(e,decodeURIComponent(u.pathname.split('/').pop())) },
  { match: (u,m) => u.pathname === '/api/admin/store-profile' && m === 'GET', run: async (r,e,u) => ({storeProfile:await getStoreProfile(e)}) },
  { match: (u,m) => u.pathname === '/api/admin/store-profile' && m === 'PATCH', run: async (r,e,u) => ({storeProfile:await updateStoreProfile(e,await r.json())}) },
  { match: (u,m) => u.pathname === '/api/admin/invoice-settings' && m === 'GET', run: async (r,e,u) => ({invoiceSettings:await getInvoiceSettings(e)}) },
  { match: (u,m) => u.pathname === '/api/admin/invoice-settings' && m === 'PATCH', run: async (r,e,u) => { const invoiceSettings=await updateInvoiceSettings(e,await r.json()); const invoiceBackfill=invoiceSettings.enabled?await backfillMissingInvoices(e):null; return {invoiceSettings,invoiceBackfill}; } },
  { match: (u,m) => u.pathname === '/api/admin/invoices/backfill' && m === 'POST', run: async (r,e,u) => ({invoiceBackfill:await backfillMissingInvoices(e)}) }
];

export async function handleAdminData(request,env){
  const u=new URL(request.url);
  try{
    if (u.pathname === '/api/admin/delivery-offers' || u.pathname.startsWith('/api/admin/coupons')) { const result = await handleAdminDeliveryOffersRequest(request,env); if (result) return result; }
    if (u.pathname === '/api/admin/customer-messages' || u.pathname.startsWith('/api/admin/customer-messages/')) { const result = await handleAdminCustomerMessages(request,env); return json(result.data,result.status); }
    if (u.pathname === '/api/admin/delivery' || u.pathname.startsWith('/api/admin/delivery/')) { const delivery=await handleAdminDeliveryRequest(request,env); if(delivery)return delivery; }
    const route=routes.find(x=>x.match(u,request.method));
    return route?json(await route.run(request,env,u)):null;
  }catch(e){
    const message=String(e?.message||'Admin data request failed.');
    if(/^ORDER_CONFLICT:/.test(message))return json({error:message.replace(/^ORDER_CONFLICT:\s*/,''),code:'ORDER_CONFLICT'},409);
    if (/DELIVERY_SLOT_FULL|DELIVERY_SLOT_CLOSED/i.test(message)) return json({error:'That delivery slot is no longer available. Refresh the delivery schedule and try again.',code:'ORDER_CONFLICT'},409);
    if (/DELIVERY_STORE_STOCK_LOW/i.test(message)) return json({error:'The selected store no longer has enough stock for this basket.',code:'ORDER_CONFLICT'},409);
    if (u.pathname === '/api/admin/delivery' || u.pathname.startsWith('/api/admin/delivery/')) {
      const safeMessage = /SQLITE|D1_ERROR|constraint failed|internal error/i.test(message) ? 'The delivery operation could not be saved safely. Refresh and review the current inventory and schedule.' : message;
      return json({error:safeMessage || 'Could not save delivery settings.'},400);
    }
    if(/^(Invalid |Choose a valid invoice|Invoice issuance is not enabled|Invoice series prefix|Enter the store name|Enter the legal business name used on invoices|Enter the complete business address used on invoices|Enter the seller state|Enter a valid two-digit seller GST state code|Enter a valid 15-character GSTIN|Seller state code must match|Seller state name and GST state code do not match|V1 requires|Add a valid HSN|Confirm the GST classification|Set the approved GST rate|The delivery address needs a valid state|This order has no invoice items|Invoices cannot be issued|Order not found|No order change|Delivery plan|Payment|Cash can|Only collected|Collected cash|Cannot change)/i.test(message))return json({error:message},400);
    const errorId=crypto.randomUUID();
    console.error(JSON.stringify({event:'freshway_admin_data_error',errorId,method:request.method,path:u.pathname,message,stack:e?.stack||''}));
    return json({error:'The server could not save this change. Refresh the order and verify its saved state before retrying.',code:'INTERNAL_ERROR',errorId},500);
  }
}
