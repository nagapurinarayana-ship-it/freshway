import { json, n, pageOf, limitOf, like, STATUSES, normalizeStatus, orderSort, localDateStart, localDateEnd } from './admin-shared.js';
import { prepareInvoiceIssue, getInvoiceSummary, getInvoiceSettings } from './invoice-service.js';

const PAYMENTS=['Not Collected','Collected','Refunded','Cancelled'];
const normalizePayment=v=>{const value=n(v);return value==='Pending'?'Not Collected':value};

export async function orders(env, u) {
  const page=pageOf(u),limit=limitOf(u),offset=(page-1)*limit;
  const search=n(u.searchParams.get('search')),status=normalizeStatus(n(u.searchParams.get('status')));
  const payment=normalizePayment(u.searchParams.get('payment')),plan=n(u.searchParams.get('plan'));
  const from=n(u.searchParams.get('from')),to=n(u.searchParams.get('to')),customer=n(u.searchParams.get('customer'));
  const minAmount=n(u.searchParams.get('minAmount')),maxAmount=n(u.searchParams.get('maxAmount'));
  const testOrders=u.searchParams.get('testOrders')==='1';
  const where=[testOrders?'o.is_test_order=1':'o.is_test_order=0'],p=[];
  if(search){
    where.push('(o.id LIKE ? OR o.customer_name LIKE ? OR COALESCE(c.name,o.customer_name) LIKE ? OR COALESCE(c.phone,o.customer_phone) LIKE ? OR COALESCE(s.delivery_phone,a.delivery_phone) LIKE ? OR a.house LIKE ? OR a.area LIKE ? OR a.city LIKE ? OR a.pincode LIKE ?)');
    const s=like(search);p.push(s,s,s,s,s,s,s,s,s);
  }
  if(customer){
    where.push('(COALESCE(c.name,o.customer_name) LIKE ? OR COALESCE(c.phone,o.customer_phone) LIKE ? OR COALESCE(s.delivery_phone,a.delivery_phone) LIKE ? OR o.customer_id=?)');
    const s=like(customer);p.push(s,s,s,customer);
  }
  if(status&&status!=='all'){
    if(!STATUSES.includes(status))throw new Error('Invalid order status filter.');
    where.push(status==='New'?"o.delivery_status IN ('New','Ordered')":'o.delivery_status=?');
    if(status!=='New')p.push(status);
  }
  if(payment&&payment!=='all'){
    if(!PAYMENTS.includes(payment))throw new Error('Invalid payment status filter.');
    where.push('o.payment_status=?');p.push(payment);
  }
  if(plan&&plan!=='all'){where.push('o.delivery_plan=?');p.push(plan);}
  const fs=localDateStart(from),te=localDateEnd(to);
  if(fs){where.push('o.created_at>=?');p.push(fs);}
  if(te){where.push('o.created_at<=?');p.push(te);}
  if(minAmount&&Number.isFinite(Number(minAmount))){where.push('o.total>=?');p.push(Number(minAmount));}
  if(maxAmount&&Number.isFinite(Number(maxAmount))){where.push('o.total<=?');p.push(Number(maxAmount));}
  const base=`FROM orders o
    LEFT JOIN customers c ON c.id=o.customer_id
    LEFT JOIN addresses a ON a.id=o.address_id
    LEFT JOIN order_address_snapshots s ON s.order_id=o.id
    LEFT JOIN invoices i ON i.order_id=o.id
    WHERE ${where.join(' AND ')}`;
  const total=Number((await env.DB.prepare(`SELECT COUNT(*) count ${base}`).bind(...p).first())?.count||0);
  const rows=(await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.is_test_order,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.payment_collected_at,
    COALESCE(c.name,o.customer_name) registered_name,COALESCE(c.phone,o.customer_phone) registered_phone,
    COALESCE(s.house_flat,a.house) house,COALESCE(s.area,a.area) area,COALESCE(s.city,a.city) city,
    COALESCE(s.pincode,a.pincode) pincode,COALESCE(s.landmark,a.landmark) landmark,
    COALESCE(s.delivery_note,a.note) note,COALESCE(s.recipient_name,a.recipient_name,o.customer_name) recipient_name,
    COALESCE(s.delivery_phone,a.delivery_phone) delivery_phone,s.building,s.floor,s.street,s.locality,s.district,s.state,
    s.latitude,s.longitude,s.accuracy_meters,s.location_source,s.place_id,s.location_updated_at,
    i.invoice_number,i.document_type invoice_document_type,i.issue_date invoice_issue_date
    ${base} ORDER BY ${orderSort(u)} LIMIT ? OFFSET ?`).bind(...p,limit,offset).all()).results||[];
  if(!rows.length)return{orders:[],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}};
  const ids=rows.map(row=>row.id),ph=ids.map(()=>'?').join(',');
  const items=(await env.DB.prepare(`SELECT order_id,product_id,name,unit,qty,price,line_total FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...ids).all()).results||[];
  const map=new Map(rows.map(row=>[row.id,{
    id:row.id,customerId:row.customer_id,
    customer:{
      name:row.registered_name||row.customer_name,
      phone:row.registered_phone||row.customer_phone,
      registeredPhone:row.registered_phone||row.customer_phone,
      recipientName:row.recipient_name||row.customer_name,
      deliveryPhone:row.delivery_phone||''
    },
    address:{
      house:row.house,houseFlat:row.house,building:row.building,floor:row.floor,street:row.street,area:row.area,
      locality:row.locality,city:row.city,district:row.district,state:row.state,pincode:row.pincode,landmark:row.landmark,
      note:row.note,recipientName:row.recipient_name||row.customer_name,deliveryPhone:row.delivery_phone||'',
      latitude:row.latitude,longitude:row.longitude,accuracyMeters:row.accuracy_meters,locationSource:row.location_source,
      placeId:row.place_id,locationUpdatedAt:row.location_updated_at
    },
    items:[],isTestOrder:Number(row.is_test_order)===1,total:row.total,payment:row.payment_status,
    status:normalizeStatus(row.delivery_status),deliveryPlan:row.delivery_plan,createdAt:row.created_at,
    updatedAt:row.updated_at,paymentCollectedAt:row.payment_collected_at,
    invoice:row.invoice_number?{number:row.invoice_number,documentType:row.invoice_document_type,issuedAt:row.invoice_issue_date}:null
  }]));
  for(const item of items)map.get(item.order_id)?.items.push({
    id:item.product_id,name:item.name,unit:item.unit,qty:item.qty,price:item.price,lineTotal:item.line_total
  });
  return{orders:[...map.values()],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}};
}

export async function updateOrder(env,id,payload){
  const status=payload.status?normalizeStatus(n(payload.status)):'';
  const payment=normalizePayment(payload.payment);
  const deliveryPlan=n(payload.deliveryPlan);
  const hasTestFlag=typeof payload.isTestOrder==='boolean';
  if(status&&!STATUSES.includes(status))throw new Error('Invalid delivery status.');
  if(payment&&!PAYMENTS.includes(payment))throw new Error('Invalid payment status.');
  if(deliveryPlan&&!['Today','Tomorrow','Later','Unscheduled'].includes(deliveryPlan))throw new Error('Invalid delivery plan.');
  const current=await env.DB.prepare('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order FROM orders WHERE id=?').bind(id).first();
  if(!current)throw new Error('Order not found.');
  const currentTest=Number(current.is_test_order||0);
  const isTestOrder=hasTestFlag?(payload.isTestOrder?1:0):currentTest;
  const sets=[],params=[],guards=['id=?'],guardParams=[id];
  if(status){sets.push('delivery_status=?');params.push(status);guards.push('delivery_status IS ?');guardParams.push(current.delivery_status)}
  if(payment){sets.push('payment_status=?');params.push(payment);sets.push(payment==='Collected'?'payment_collected_at=CURRENT_TIMESTAMP':'payment_collected_at=NULL');guards.push('payment_status IS ?');guardParams.push(current.payment_status)}
  if(deliveryPlan){sets.push('delivery_plan=?');params.push(deliveryPlan);guards.push('delivery_plan IS ?');guardParams.push(current.delivery_plan)}
  if(hasTestFlag){guards.push('is_test_order IS ?');guardParams.push(currentTest);if(isTestOrder!==currentTest){sets.push('is_test_order=?');params.push(isTestOrder)}}
  if(!sets.length)throw new Error('No order change supplied.');
  sets.push('updated_at=CURRENT_TIMESTAMP');
  const sql='UPDATE orders SET '+sets.join(',')+' WHERE '+guards.join(' AND ');
  // Persist the valid order lifecycle/payment change independently of invoice
  // validation. Missing HSN/GST metadata must not make an otherwise valid
  // status update fail or silently revert to the prior database value.
  const result=await env.DB.prepare(sql).bind(...params,...guardParams).run();
  if(!result.meta?.changes)throw new Error('ORDER_CONFLICT: This order changed while you were saving. Refresh the order and try again.');

  const shouldIssueInvoice=!isTestOrder&&!!status&&['Out for Delivery','Delivered'].includes(status);
  let invoiceSummary=null,invoiceWarning='';
  if(shouldIssueInvoice){
    try{
      const invoiceSettings=await getInvoiceSettings(env);
      if(invoiceSettings?.enabled){
        const invoiceIssue=await prepareInvoiceIssue(env,id,status);
        if(invoiceIssue){
          if(typeof env.DB.batch!=='function')throw new Error('This environment does not support invoice issuance.');
          await env.DB.batch(invoiceIssue.statements);
          invoiceSummary=await getInvoiceSummary(env,id);
          if(!invoiceSummary)throw new Error('Invoice issuance could not be confirmed.');
        }else{
          invoiceSummary=await getInvoiceSummary(env,id);
        }
      }
    }catch(error){
      invoiceWarning=String(error?.message||'Invoice could not be issued. Review Billing & tax and product details.');
    }
  }
  return{ok:true,status:status||normalizeStatus(current.delivery_status),payment:payment||current.payment_status,deliveryPlan:deliveryPlan||current.delivery_plan,isTestOrder,testClassificationChanged:hasTestFlag&&isTestOrder!==currentTest,invoice:invoiceSummary,...(invoiceWarning?{invoiceWarning}:{})}
}
