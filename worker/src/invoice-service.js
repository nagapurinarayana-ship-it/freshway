import { getStoreProfile } from './store-profile.js';

const TYPES = new Set(['commercial_invoice','gst_tax_invoice','bill_of_supply']);
const STATE_CODES = Object.freeze({
  'JAMMU AND KASHMIR':'01','JAMMU & KASHMIR':'01','HIMACHAL PRADESH':'02','PUNJAB':'03','CHANDIGARH':'04',
  'UTTARAKHAND':'05','HARYANA':'06','DELHI':'07','NCT OF DELHI':'07','RAJASTHAN':'08','UTTAR PRADESH':'09',
  'BIHAR':'10','SIKKIM':'11','ARUNACHAL PRADESH':'12','NAGALAND':'13','MANIPUR':'14','MIZORAM':'15',
  'TRIPURA':'16','MEGHALAYA':'17','ASSAM':'18','WEST BENGAL':'19','JHARKHAND':'20','ODISHA':'21',
  'ORISSA':'21','CHHATTISGARH':'22','MADHYA PRADESH':'23','GUJARAT':'24','DAMAN AND DIU':'25',
  'DADRA AND NAGAR HAVELI':'26','MAHARASHTRA':'27','KARNATAKA':'29','GOA':'30','LAKSHADWEEP':'31',
  'KERALA':'32','TAMIL NADU':'33','PUDUCHERRY':'34','PONDICHERRY':'34','ANDAMAN AND NICOBAR ISLANDS':'35',
  'TELANGANA':'36','ANDHRA PRADESH':'37','LADAKH':'38','OTHER TERRITORY':'97'
});
const trim=(v,max=500)=>String(v??'').trim().slice(0,max);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const round=n=>Math.round(Number(n)||0);
const validGstin=value=>/^[0-9]{2}[A-Z0-9]{13}$/.test(String(value||'').toUpperCase());
const codeFromState=state=>STATE_CODES[String(state||'').trim().toUpperCase().replace(/\s+/g,' ')]||'';
const toFinancialYear=dateString=>{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(new Date(dateString||Date.now()));
  const year=Number(parts.find(p=>p.type==='year')?.value),month=Number(parts.find(p=>p.type==='month')?.value);
  const start=month>=4?year:year-1;
  return String(start).slice(-2)+'-'+String(start+1).slice(-2);
};
const safeSeries=value=>trim(value,2).toUpperCase();
const amountPaisa=rupees=>round(Number(rupees||0)*100);

export async function getInvoiceSettings(env){
  const row=await env.DB.prepare('SELECT enabled,document_type,legal_name,business_address,state_name,state_code,gstin,series_prefix,footer,prices_include_tax,updated_at FROM invoice_settings WHERE id=1').first();
  return {
    enabled:Number(row?.enabled||0)===1,
    documentType:TYPES.has(row?.document_type)?row.document_type:'commercial_invoice',
    legalName:row?.legal_name||'',businessAddress:row?.business_address||'',stateName:row?.state_name||'',
    stateCode:row?.state_code||'',gstin:row?.gstin||'',seriesPrefix:row?.series_prefix||'FW',
    footer:row?.footer||'',pricesIncludeTax:Number(row?.prices_include_tax??1)===1,updatedAt:row?.updated_at||null
  };
}
function validateSettings(s){
  if(!TYPES.has(s.documentType))throw new Error('Choose a valid invoice document type.');
  if(!s.legalName)throw new Error('Enter the legal business name used on invoices.');
  if(!s.businessAddress)throw new Error('Enter the complete business address used on invoices.');
  if(!s.stateName)throw new Error('Enter the seller state.');
  if(!/^\d{2}$/.test(s.stateCode))throw new Error('Enter a valid two-digit seller GST state code.');
  if(!/^[A-Z0-9]{1,2}$/.test(s.seriesPrefix))throw new Error('Invoice series prefix must contain one or two letters or numbers.');
  if(!s.pricesIncludeTax)throw new Error('V1 requires catalogue prices to be tax-inclusive. Tax-exclusive checkout totals are not supported.');
  if(s.documentType==='commercial_invoice'){
    if(s.gstin)throw new Error('A GSTIN is entered. Select the document type confirmed for your GST registration instead of issuing a non-GST commercial invoice.');
    return;
  }
  if(!validGstin(s.gstin))throw new Error('Enter a valid 15-character GSTIN for the selected GST document.');
  if(s.gstin.slice(0,2)!==s.stateCode)throw new Error('Seller state code must match the first two digits of the GSTIN.');
  const actual=codeFromState(s.stateName);
  if(actual&&actual!==s.stateCode)throw new Error('Seller state name and GST state code do not match.');
}
export async function updateInvoiceSettings(env,payload={}){
  const current=await getInvoiceSettings(env);
  const s={
    enabled:payload.enabled===undefined?current.enabled:payload.enabled===true,
    documentType:trim(payload.documentType??current.documentType,40),
    legalName:trim(payload.legalName??current.legalName,160),
    businessAddress:trim(payload.businessAddress??current.businessAddress,600),
    stateName:trim(payload.stateName??current.stateName,80),
    stateCode:trim(payload.stateCode??current.stateCode,2),
    gstin:trim(payload.gstin??current.gstin,15).toUpperCase(),
    seriesPrefix:safeSeries(payload.seriesPrefix??current.seriesPrefix),
    footer:trim(payload.footer??current.footer,500),
    pricesIncludeTax:payload.pricesIncludeTax===undefined?current.pricesIncludeTax:payload.pricesIncludeTax===true
  };
  if(s.enabled)validateSettings(s);
  else {
    if(!TYPES.has(s.documentType))throw new Error('Choose a valid invoice document type.');
    if(s.seriesPrefix&&!/^[A-Z0-9]{1,2}$/.test(s.seriesPrefix))throw new Error('Invoice series prefix must contain one or two letters or numbers.');
  }
  await env.DB.prepare('INSERT INTO invoice_settings(id,enabled,document_type,legal_name,business_address,state_name,state_code,gstin,series_prefix,footer,prices_include_tax,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,document_type=excluded.document_type,legal_name=excluded.legal_name,business_address=excluded.business_address,state_name=excluded.state_name,state_code=excluded.state_code,gstin=excluded.gstin,series_prefix=excluded.series_prefix,footer=excluded.footer,prices_include_tax=excluded.prices_include_tax,updated_at=CURRENT_TIMESTAMP')
    .bind(s.enabled?1:0,s.documentType,s.legalName,s.businessAddress,s.stateName,s.stateCode,s.gstin,s.seriesPrefix,s.footer,s.pricesIncludeTax?1:0).run();
  return getInvoiceSettings(env);
}
function validateIssueConfig(settings,items,address){
  if(!settings.enabled)throw new Error('Invoice issuance is not enabled. Finish Owner → Settings → Billing & tax before dispatching this order.');
  validateSettings(settings);
  if(!items.length)throw new Error('This order has no invoice items.');
  if(settings.documentType!=='commercial_invoice'){
    for(const item of items){
      if(!/^\d{4,8}$/.test(String(item.hsn_code||'')))throw new Error('Add a valid HSN code to '+item.name+' in Owner → Catalogue before issuing this invoice.');
      if(Number(item.gst_rate_confirmed)!==1)throw new Error('Confirm the GST classification and rate with your accountant for '+item.name+' in Owner → Catalogue.');
      if(!Number.isInteger(Number(item.gst_rate_bps))||Number(item.gst_rate_bps)<0||Number(item.gst_rate_bps)>4000)throw new Error('Set the approved GST rate for '+item.name+' in Owner → Catalogue.');
    }
  }
  if(settings.documentType==='gst_tax_invoice'&&!codeFromState(address.state))throw new Error('The delivery address needs a valid state before a GST tax invoice can be issued.');
}
function buildItemTax(item,settings,sellerStateCode,buyerStateCode){
  const gross=amountPaisa(item.line_total),rate=settings.documentType==='gst_tax_invoice'?Number(item.gst_rate_bps||0):0;
  const taxable=rate?round(gross*10000/(10000+rate)):gross;
  const tax=Math.max(0,gross-taxable);
  const interstate=!!buyerStateCode&&buyerStateCode!==sellerStateCode;
  const igst=settings.documentType==='gst_tax_invoice'&&interstate?tax:0;
  const cgst=settings.documentType==='gst_tax_invoice'&&!interstate?Math.floor(tax/2):0;
  const sgst=settings.documentType==='gst_tax_invoice'&&!interstate?tax-cgst:0;
  return {productId:item.product_id,name:item.name,unit:item.unit,qty:Number(item.qty),unitPricePaise:amountPaisa(item.price),grossPaise:gross,hsnCode:item.hsn_code||'',gstRateBps:rate,taxablePaise:taxable,cgstPaise:cgst,sgstPaise:sgst,igstPaise:igst};
}
const sumBy=(items,key)=>items.reduce((sum,i)=>sum+Number(i[key]||0),0);
export async function prepareInvoiceIssue(env,orderId,targetStatus){
  const existing=await env.DB.prepare('SELECT id,invoice_number,document_type FROM invoices WHERE order_id=? LIMIT 1').bind(orderId).first();
  if(existing)return null;
  const order=await env.DB.prepare('SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.total,o.delivery_status,o.is_test_order,o.created_at,c.name registered_name,c.phone registered_phone,COALESCE(s.recipient_name,a.recipient_name,o.customer_name) recipient_name,COALESCE(s.delivery_phone,a.delivery_phone) delivery_phone,COALESCE(s.house_flat,a.house) house,COALESCE(s.building,a.building) building,COALESCE(s.floor,a.floor) floor,COALESCE(s.street,a.street) street,COALESCE(s.area,a.area) area,COALESCE(s.locality,a.locality) locality,COALESCE(s.city,a.city) city,COALESCE(s.district,a.district) district,COALESCE(s.state,a.state) state,COALESCE(s.pincode,a.pincode) pincode,COALESCE(s.landmark,a.landmark) landmark,COALESCE(s.delivery_note,a.note) note FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN addresses a ON a.id=o.address_id LEFT JOIN order_address_snapshots s ON s.order_id=o.id WHERE o.id=? LIMIT 1').bind(orderId).first();
  if(!order)throw new Error('Order not found.');
  if(Number(order.is_test_order||0)===1)throw new Error('Invoices cannot be issued for test orders.');
  if(String(order.delivery_status||'')==='Cancelled')throw new Error('Invoices cannot be issued for cancelled orders.');
  const settings=await getInvoiceSettings(env),store=await getStoreProfile(env);
  const itemRows=(await env.DB.prepare('SELECT product_id,name,unit,qty,price,line_total,hsn_code,gst_rate_bps,gst_rate_confirmed FROM order_items WHERE order_id=? ORDER BY id').bind(orderId).all()).results||[];
  const address={house:order.house,building:order.building,floor:order.floor,street:order.street,area:order.area,locality:order.locality,city:order.city,district:order.district,state:order.state,pincode:order.pincode,landmark:order.landmark,note:order.note,recipientName:order.recipient_name,deliveryPhone:order.delivery_phone};
  validateIssueConfig(settings,itemRows,address);
  const buyerStateCode=settings.documentType==='gst_tax_invoice'?codeFromState(address.state):'';
  const items=itemRows.map(item=>buildItemTax(item,settings,settings.stateCode,buyerStateCode));
  const grossTotal=sumBy(items,'grossPaise'),orderTotal=amountPaisa(order.total);
  if(grossTotal!==orderTotal)throw new Error('Invoice item totals do not match the saved order total. Please review this order before dispatch.');
  const totals={grossPaise:grossTotal,taxablePaise:sumBy(items,'taxablePaise'),cgstPaise:sumBy(items,'cgstPaise'),sgstPaise:sumBy(items,'sgstPaise'),igstPaise:sumBy(items,'igstPaise'),totalPaise:grossTotal};
  const issuedAt=new Date().toISOString(),financialYear=toFinancialYear(issuedAt);
  const invoiceId='inv-'+String(orderId).replace(/[^A-Za-z0-9_-]/g,'').slice(0,100);
  const sellerSnapshot={storeName:store.storeName,legalName:settings.legalName,address:settings.businessAddress,stateName:settings.stateName,stateCode:settings.stateCode,gstin:settings.gstin,phone:store.phone,email:store.email,documentType:settings.documentType,footer:settings.footer};
  const buyerSnapshot={name:order.registered_name||order.customer_name,phone:order.registered_phone||order.customer_phone,recipientName:address.recipientName||order.customer_name,deliveryPhone:address.deliveryPhone||order.customer_phone,address,stateCode:buyerStateCode,placeOfSupply:settings.documentType==='gst_tax_invoice'?address.state:''};
  const totalsSnapshot={...totals,currency:'INR',pricesIncludeTax:true};
  const updateSequence=env.DB.prepare('INSERT INTO invoice_sequences(financial_year,last_number,updated_at) SELECT ?,1,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND delivery_status=? AND is_test_order=0) AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=?) ON CONFLICT(financial_year) DO UPDATE SET last_number=invoice_sequences.last_number+1,updated_at=CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND delivery_status=? AND is_test_order=0) AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=?)').bind(financialYear,orderId,targetStatus,orderId,orderId,targetStatus,orderId);
  const insertInvoice=env.DB.prepare("INSERT INTO invoices(id,order_id,customer_id,invoice_number,document_type,financial_year,issue_date,seller_snapshot,buyer_snapshot,totals_snapshot) SELECT ?,?,?,printf('%s/%s/%06d',?,?,last_number),?,?,?,?,? FROM invoice_sequences WHERE financial_year=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND delivery_status=? AND is_test_order=0) AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=?)")

    .bind(invoiceId,orderId,order.customer_id,settings.seriesPrefix,financialYear,settings.documentType,financialYear,issuedAt,JSON.stringify(sellerSnapshot),JSON.stringify(buyerSnapshot),JSON.stringify(totalsSnapshot),financialYear,orderId,targetStatus,orderId);
  const itemStatements=items.map(item=>env.DB.prepare('INSERT INTO invoice_items(invoice_id,product_id,name,unit,qty,unit_price_paise,gross_paise,hsn_code,gst_rate_bps,taxable_paise,cgst_paise,sgst_paise,igst_paise) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM invoices WHERE order_id=? AND id=?)')
    .bind(invoiceId,item.productId,item.name,item.unit,item.qty,item.unitPricePaise,item.grossPaise,item.hsnCode,item.gstRateBps,item.taxablePaise,item.cgstPaise,item.sgstPaise,item.igstPaise,orderId,invoiceId));
  return {statements:[updateSequence,insertInvoice,...itemStatements],invoiceId,financialYear};
}
export async function getInvoiceRecord(env,orderId){
  const inv=await env.DB.prepare('SELECT * FROM invoices WHERE order_id=? LIMIT 1').bind(orderId).first();
  if(!inv)return null;
  const items=(await env.DB.prepare('SELECT product_id,name,unit,qty,unit_price_paise,gross_paise,hsn_code,gst_rate_bps,taxable_paise,cgst_paise,sgst_paise,igst_paise FROM invoice_items WHERE invoice_id=? ORDER BY id').bind(inv.id).all()).results||[];
  let seller={},buyer={},totals={};
  try{seller=JSON.parse(inv.seller_snapshot||'{}');buyer=JSON.parse(inv.buyer_snapshot||'{}');totals=JSON.parse(inv.totals_snapshot||'{}')}catch(_){throw new Error('Stored invoice snapshot is invalid.')}
  return {id:inv.id,orderId:inv.order_id,customerId:inv.customer_id,invoiceNumber:inv.invoice_number,documentType:inv.document_type,financialYear:inv.financial_year,issueDate:inv.issue_date,seller,buyer,totals,items:items.map(i=>({productId:i.product_id,name:i.name,unit:i.unit,qty:i.qty,unitPricePaise:i.unit_price_paise,grossPaise:i.gross_paise,hsnCode:i.hsn_code,gstRateBps:i.gst_rate_bps,taxablePaise:i.taxable_paise,cgstPaise:i.cgst_paise,sgstPaise:i.sgst_paise,igstPaise:i.igst_paise}))};
}
export async function getInvoiceSummary(env,orderId){
  const row=await env.DB.prepare('SELECT invoice_number,document_type,issue_date FROM invoices WHERE order_id=? LIMIT 1').bind(orderId).first();
  return row?{number:row.invoice_number,documentType:row.document_type,issuedAt:row.issue_date}:null;
}
export { json as invoiceJson };
