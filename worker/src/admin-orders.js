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
    LEFT JOIN delivery_stores ds ON ds.id=o.assigned_store_id
    WHERE ${where.join(' AND ')}`;
  const total=Number((await env.DB.prepare(`SELECT COUNT(*) count ${base}`).bind(...p).first())?.count||0);
  const rows=(await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.is_test_order,o.total,o.items_subtotal,o.delivery_fee,o.coupon_code,o.coupon_discount,o.pricing_breakdown_known,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.delivered_at,o.payment_collected_at,o.scheduled_delivery_date,o.scheduled_slot_id,o.assigned_store_id,o.scheduled_start_minute,o.scheduled_end_minute,o.schedule_status,ds.name assigned_store_name,
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
    items:[],isTestOrder:Number(row.is_test_order)===1,total:row.total,pricingBreakdownKnown:Number(row.pricing_breakdown_known)===1,itemsSubtotal:Number(row.pricing_breakdown_known)===1?row.items_subtotal:null,deliveryFee:Number(row.pricing_breakdown_known)===1?row.delivery_fee:null,couponCode:Number(row.pricing_breakdown_known)===1?(row.coupon_code||null):null,couponDiscount:Number(row.pricing_breakdown_known)===1?row.coupon_discount:null,payment:row.payment_status,
    status:normalizeStatus(row.delivery_status),deliveryPlan:row.delivery_plan,createdAt:row.created_at,
    updatedAt:row.updated_at,deliveredAt:row.delivered_at,paymentCollectedAt:row.payment_collected_at,
     scheduledDelivery:row.scheduled_delivery_date?{date:row.scheduled_delivery_date,slotId:row.scheduled_slot_id,storeId:row.assigned_store_id,storeName:row.assigned_store_name||'',startMinute:row.scheduled_start_minute,endMinute:row.scheduled_end_minute,startTime:row.scheduled_start_minute==null?'':String(Math.floor(Number(row.scheduled_start_minute)/60)).padStart(2,'0')+':'+String(Number(row.scheduled_start_minute)%60).padStart(2,'0'),endTime:row.scheduled_end_minute==null?'':String(Math.floor(Number(row.scheduled_end_minute)/60)).padStart(2,'0')+':'+String(Number(row.scheduled_end_minute)%60).padStart(2,'0'),status:row.schedule_status||'unscheduled'}:null,scheduleStatus:row.schedule_status||'unscheduled',
    invoice:row.invoice_number?{number:row.invoice_number,documentType:row.invoice_document_type,issuedAt:row.invoice_issue_date}:null
  }]));
  for(const item of items)map.get(item.order_id)?.items.push({
    id:item.product_id,name:item.name,unit:item.unit,qty:item.qty,price:item.price,lineTotal:item.line_total
  });
  return{orders:[...map.values()],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}};
}

export async function updateOrder(env,id,payload,actor={}){
  const status=payload.status?normalizeStatus(n(payload.status)):'';
  const payment=normalizePayment(payload.payment);
  const deliveryPlan=n(payload.deliveryPlan);
  const hasTestFlag=typeof payload.isTestOrder==='boolean';
  const actorType=['customer','system'].includes(n(actor.actorType))?n(actor.actorType):'owner';
  const actorId=n(actor.actorId)|| (actorType==='owner'?'owner':'');
  const reason=n(actor.reason).slice(0,500);
  if(status&&!STATUSES.includes(status))throw new Error('Invalid delivery status.');
  if(payment&&!PAYMENTS.includes(payment))throw new Error('Invalid payment status.');
  if(deliveryPlan&&!['Today','Tomorrow','Later','Unscheduled'].includes(deliveryPlan))throw new Error('Invalid delivery plan.');
  const current=await env.DB.prepare('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order,delivered_at,assigned_store_id,scheduled_slot_id,scheduled_delivery_date,scheduled_start_minute,scheduled_end_minute,schedule_status FROM orders WHERE id=?').bind(id).first();
  if(!current)throw new Error('Order not found.');
  const currentStatus=normalizeStatus(current.delivery_status);
  const currentTest=Number(current.is_test_order||0);
  const isTestOrder=hasTestFlag?(payload.isTestOrder?1:0):currentTest;
  const cancelling=status==='Cancelled'&&currentStatus!=='Cancelled'&&currentStatus!=='Delivered';
  const reopening=Boolean(status)&&currentStatus==='Cancelled'&&status!=='Cancelled';
  const delivering=status==='Delivered'&&currentStatus!=='Delivered';
  const deliveringFromCancelled=delivering&&currentStatus==='Cancelled';
  const needsScheduleReview=reopening&&(!!current.assigned_store_id||!!current.scheduled_slot_id||!!current.scheduled_delivery_date);
  let reopeningNeeded=[];
  let reopeningStockConflict=false;
  if(reopening&&!deliveringFromCancelled){
    reopeningNeeded=(await env.DB.prepare('SELECT oi.product_id, SUM(CASE WHEN oi.stock_reserved_qty=0 THEN oi.qty ELSE 0 END) AS reserve_qty, MAX(p.stock_quantity) AS available_stock, MAX(p.name) AS product_name FROM order_items oi JOIN products p ON p.id=oi.product_id AND p.stock_managed=1 WHERE oi.order_id=? GROUP BY oi.product_id HAVING SUM(CASE WHEN oi.stock_reserved_qty=0 THEN oi.qty ELSE 0 END)>0').bind(id).all()).results||[];
    reopeningStockConflict=reopeningNeeded.some(item=>Number(item.available_stock||0)<Number(item.reserve_qty||0));
  }
  const sets=[],params=[],guards=['id=?'],guardParams=[id];
  if(status){sets.push('delivery_status=?');params.push(status);guards.push('delivery_status IS ?');guardParams.push(current.delivery_status)}
  if(delivering&&!current.delivered_at){sets.push('delivered_at=CURRENT_TIMESTAMP');}
  if(payment){sets.push('payment_status=?');params.push(payment);sets.push(payment==='Collected'?'payment_collected_at=CURRENT_TIMESTAMP':'payment_collected_at=NULL');guards.push('payment_status IS ?');guardParams.push(current.payment_status)}
  if(deliveryPlan){sets.push('delivery_plan=?');params.push(deliveryPlan);guards.push('delivery_plan IS ?');guardParams.push(current.delivery_plan)}
  if(hasTestFlag){guards.push('is_test_order IS ?');guardParams.push(currentTest);if(isTestOrder!==currentTest){sets.push('is_test_order=?');params.push(isTestOrder)}}
  if(cancelling&&(current.assigned_store_id||current.scheduled_slot_id||current.scheduled_delivery_date)){
    sets.push("schedule_status='cancelled'");
  }else if(delivering&&(current.assigned_store_id||current.scheduled_slot_id||current.scheduled_delivery_date)){
    sets.push("schedule_status='completed'");
  }else if(reopening&&needsScheduleReview){
    sets.push("schedule_status='conflict'");
  }else if(currentStatus==='Delivered'&&status==='Cancelled'&&(current.assigned_store_id||current.scheduled_slot_id||current.scheduled_delivery_date)){
    sets.push("schedule_status='conflict'");
  }
  if(!sets.length)throw new Error('No order change supplied.');
  sets.push('updated_at=CURRENT_TIMESTAMP');
  const sql='UPDATE orders SET '+sets.join(',')+' WHERE '+guards.join(' AND ');
  const orderUpdate=env.DB.prepare(sql).bind(...params,...guardParams);
  const auditAfter={status:status||currentStatus,payment:payment||current.payment_status,deliveryPlan:deliveryPlan||current.delivery_plan,
    scheduleStatus:cancelling?'cancelled':delivering?'completed':(needsScheduleReview&&reopening)?'conflict':current.schedule_status||'unscheduled'};
  const auditStatement=()=>env.DB.prepare('INSERT INTO order_audit_events (id,order_id,actor_type,actor_id,action,reason,before_json,after_json) VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),id,actorType,actorId,
      status&&currentStatus!==status?(currentStatus==='Delivered'&&status==='Cancelled'?'delivered_order_corrected_to_cancelled':actorType==='customer'&&status==='Cancelled'?'order_cancelled_by_customer':'order_status_changed'):
      payment&&current.payment_status!==payment?'order_payment_status_changed':'order_updated',
      reason,JSON.stringify(current),JSON.stringify(auditAfter));
  const flagStatement=(flagType,details)=>env.DB.prepare("INSERT INTO order_operational_flags (id,order_id,flag_type,status,details_json) VALUES (?,?,?,'open',?) ON CONFLICT DO NOTHING")
    .bind(crypto.randomUUID(),id,flagType,JSON.stringify(details||{}));
  const releaseStoreAndSlotStatements=()=>[
    env.DB.prepare("UPDATE delivery_store_inventory_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(id),
    env.DB.prepare("UPDATE delivery_slot_reservations SET status='released',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(id)
  ];
  let statements=[];
  let stockConflictDetails=[];
  // Cancelling releases unfulfilled global, store and slot reservations as one D1 batch.
  if(cancelling){
    const reserved=(await env.DB.prepare('SELECT product_id,SUM(stock_reserved_qty) AS reserved_qty FROM order_items WHERE order_id=? AND stock_reserved_qty>0 GROUP BY product_id').bind(id).all()).results||[];
    statements=reserved.map(item=>env.DB.prepare('UPDATE products SET stock_quantity=stock_quantity+? WHERE id=? AND stock_managed=1 AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.delivery_status IS ?)').bind(Number(item.reserved_qty),item.product_id,id,current.delivery_status));
    if(reserved.length)statements.push(env.DB.prepare('UPDATE order_items SET stock_reserved_qty=0 WHERE order_id=? AND stock_reserved_qty>0 AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.delivery_status IS ?)').bind(id,id,current.delivery_status));
    if(current.assigned_store_id||current.scheduled_slot_id)statements.push(...releaseStoreAndSlotStatements());
    statements.push(orderUpdate,auditStatement());
  }else if(reopening&&!deliveringFromCancelled){
    // Never block Owner control. If inventory has become insufficient, reopen the order,
    // reserve no negative stock, and mark it for immediate Owner reconciliation.
    if(!reopeningStockConflict&&reopeningNeeded.length){
      for(const item of reopeningNeeded){
        const quantity=Number(item.reserve_qty||0);
        statements.push(env.DB.prepare('UPDATE products SET stock_quantity=stock_quantity-? WHERE id=? AND stock_managed=1 AND stock_quantity>=? AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.delivery_status IS ?)').bind(quantity,item.product_id,quantity,id,current.delivery_status));
        statements.push(env.DB.prepare('UPDATE order_items SET stock_reserved_qty=qty WHERE order_id=? AND product_id=? AND stock_reserved_qty=0 AND EXISTS(SELECT 1 FROM orders o WHERE o.id=? AND o.delivery_status IS ?)').bind(id,item.product_id,id,current.delivery_status));
      }
    }
    if(needsScheduleReview){
      // Keep the former slot and store stock visible as conflicts until Owner picks a valid slot.
      if(current.assigned_store_id){
        const lines=(await env.DB.prepare('SELECT oi.product_id,oi.qty FROM order_items oi JOIN products p ON p.id=oi.product_id AND p.stock_managed=1 WHERE oi.order_id=?').bind(id).all()).results||[];
        for(const line of lines){
          statements.push(env.DB.prepare("INSERT INTO delivery_store_inventory_reservations (id,order_id,store_id,product_id,qty,status,owner_override,override_reason) SELECT ?,?,?,?,?, 'conflict',1,? WHERE NOT EXISTS(SELECT 1 FROM delivery_store_inventory_reservations WHERE order_id=? AND product_id=? AND status IN ('reserved','conflict'))")
            .bind(crypto.randomUUID(),id,current.assigned_store_id,line.product_id,Number(line.qty),'Owner reopened order; verify inventory and delivery schedule',id,line.product_id));
        }
      }
      if(current.scheduled_slot_id){
        statements.push(env.DB.prepare("INSERT INTO delivery_slot_reservations (id,order_id,slot_id,status,owner_override,override_reason) SELECT ?,?,?,'conflict',1,? WHERE NOT EXISTS(SELECT 1 FROM delivery_slot_reservations WHERE order_id=? AND status IN ('reserved','conflict'))")
          .bind(crypto.randomUUID(),id,current.scheduled_slot_id,'Owner reopened order; confirm delivery slot',id));
      }
    }
    statements.push(orderUpdate,auditStatement());
    if(reopeningStockConflict){
      stockConflictDetails=reopeningNeeded.filter(item=>Number(item.available_stock||0)<Number(item.reserve_qty||0)).map(item=>({productId:item.product_id,productName:item.product_name,available:Number(item.available_stock||0),required:Number(item.reserve_qty||0)}));
      statements.push(flagStatement('reopen_stock_shortfall',{products:stockConflictDetails,ownerActionRequired:true}));
    }
    if(needsScheduleReview)statements.push(flagStatement('reopened_order_needs_schedule_confirmation',{scheduledSlotId:current.scheduled_slot_id||null,storeId:current.assigned_store_id||null}));
  }else if(delivering){
    if(deliveringFromCancelled){
      // An Owner may correct a cancelled order to Delivered. Remove it from available stock
      // without negative quantities and record any discrepancy for manual reconciliation.
      const items=(await env.DB.prepare('SELECT oi.product_id,oi.qty,p.stock_quantity,p.name FROM order_items oi JOIN products p ON p.id=oi.product_id AND p.stock_managed=1 WHERE oi.order_id=? AND oi.stock_reserved_qty=0').bind(id).all()).results||[];
      for(const item of items){
        const available=Number(item.stock_quantity||0),qty=Number(item.qty||0);
        statements.push(env.DB.prepare('UPDATE products SET stock_quantity=MAX(0,stock_quantity-?) WHERE id=? AND stock_managed=1').bind(qty,item.product_id));
        if(available<qty)stockConflictDetails.push({productId:item.product_id,productName:item.name,available,required:qty});
      }
    }
    if(current.assigned_store_id){
      let local=(await env.DB.prepare("SELECT r.id,r.store_id,r.product_id,r.qty,i.stock_quantity FROM delivery_store_inventory_reservations r LEFT JOIN delivery_store_inventory i ON i.store_id=r.store_id AND i.product_id=r.product_id WHERE r.order_id=? AND r.status IN ('reserved','conflict')").bind(id).all()).results||[];
      if(deliveringFromCancelled&&!local.length){
        local=(await env.DB.prepare('SELECT NULL id,? store_id,oi.product_id,oi.qty,i.stock_quantity FROM order_items oi JOIN products p ON p.id=oi.product_id AND p.stock_managed=1 LEFT JOIN delivery_store_inventory i ON i.store_id=? AND i.product_id=oi.product_id WHERE oi.order_id=?').bind(current.assigned_store_id,current.assigned_store_id,id).all()).results||[];
      }
      for(const item of local){
        statements.push(env.DB.prepare('UPDATE delivery_store_inventory SET stock_quantity=MAX(0,stock_quantity-?),updated_at=CURRENT_TIMESTAMP WHERE store_id=? AND product_id=?').bind(Number(item.qty||0),item.store_id,item.product_id));
        if(item.id)statements.push(env.DB.prepare("UPDATE delivery_store_inventory_reservations SET status='fulfilled',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(item.id));
        if(Number(item.stock_quantity||0)<Number(item.qty||0))stockConflictDetails.push({productId:item.product_id,storeId:item.store_id,available:Number(item.stock_quantity||0),required:Number(item.qty||0)});
      }
    }
    if(current.assigned_store_id||current.scheduled_slot_id)statements.push(env.DB.prepare("UPDATE delivery_slot_reservations SET status='completed',updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND status IN ('reserved','conflict')").bind(id));
    statements.push(orderUpdate,auditStatement());
    if(stockConflictDetails.length)statements.push(flagStatement('delivered_stock_shortfall',{products:stockConflictDetails,ownerActionRequired:true}));
  }else{
    statements=[orderUpdate,auditStatement()];
    if(currentStatus==='Delivered'&&status==='Cancelled')statements.push(flagStatement('delivered_order_correction_review',{message:'Order status was corrected after delivery; review return and restock separately.'}));
  }
  let updateResult;
  const orderUpdateIndex=statements.indexOf(orderUpdate);
  try{
    const batchResult=typeof env.DB.batch==='function'?await env.DB.batch(statements):await Promise.all(statements.map(statement=>statement.run()));
    updateResult=batchResult?.[orderUpdateIndex];
  }catch(error){
    if(/DELIVERY_SLOT_FULL|DELIVERY_SLOT_CLOSED/i.test(String(error?.message||'')))throw new Error('ORDER_CONFLICT: Delivery slot capacity changed during the operation. Review the schedule and retry.');
    if(/DELIVERY_STORE_STOCK_LOW/i.test(String(error?.message||'')))throw new Error('ORDER_CONFLICT: Store stock changed during the operation. Review inventory and retry.');
    if(/stock_quantity|CHECK constraint failed|constraint failed/i.test(String(error?.message||'')))throw new Error('ORDER_CONFLICT: Inventory changed during the operation. Refresh the order and try again.');
    throw error;
  }
  if(!updateResult?.meta?.changes)throw new Error('ORDER_CONFLICT: This order changed while you were saving. Refresh the order and try again.');
  if(stockConflictDetails.length)console.warn('FreshWay Owner order correction recorded an inventory shortfall.',JSON.stringify({orderId:id,items:stockConflictDetails}));

  // Invoice issuance runs only after the status update is durable. A document validation
  // warning must never roll back a valid Owner correction or order lifecycle transition.
  const shouldIssueInvoice=!isTestOrder&&!!status&&['Out for Delivery','Delivered'].includes(status);
  let invoiceSummary=null,invoiceWarning='',invoiceFallbackReason='';
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
          if(invoiceIssue.fallbackReason)invoiceFallbackReason=invoiceIssue.fallbackReason;
        }else invoiceSummary=await getInvoiceSummary(env,id);
      }
    }catch(error){
      invoiceWarning=String(error?.message||'Invoice could not be issued. Review Billing & tax and product details.');
    }
  }
  return {ok:true,status:status||currentStatus,payment:payment||current.payment_status,
    deliveryPlan:deliveryPlan||current.delivery_plan,isTestOrder,
    testClassificationChanged:hasTestFlag&&isTestOrder!==currentTest,
    ...(reopeningStockConflict?{inventoryWarning:'Order reopened with stock conflict; Owner reconciliation is required.'}:{}),
    ...(needsScheduleReview&&reopening?{scheduleWarning:'Order reopened. Confirm inventory and reschedule delivery before fulfilment.'}:{}),
    ...(stockConflictDetails.length?{inventoryWarning:'Order status saved, but an inventory shortfall was recorded for Owner review.'}:{}),
    invoice:invoiceSummary,...(invoiceFallbackReason?{invoiceFallbackReason}:{}),...(invoiceWarning?{invoiceWarning}:{})};
}
