import { json, n, pageOf, limitOf, like, STATUSES, normalizeStatus, normalizePaymentStatus, validateOrderPatch, orderSort, localDateStart, localDateEnd } from './admin-shared.js';

const PAYMENTS=['Not Collected','Collected','Refunded','Cancelled'];
const normalizePayment=normalizePaymentStatus;

export async function orders(env,u){const page=pageOf(u),limit=limitOf(u),offset=(page-1)*limit,search=n(u.searchParams.get('search')),status=normalizeStatus(n(u.searchParams.get('status'))),payment=normalizePayment(u.searchParams.get('payment')),plan=n(u.searchParams.get('plan')),from=n(u.searchParams.get('from')),to=n(u.searchParams.get('to')),customer=n(u.searchParams.get('customer')),minAmount=n(u.searchParams.get('minAmount')),maxAmount=n(u.searchParams.get('maxAmount'));const testOrders=u.searchParams.get('testOrders')==='1';const where=[testOrders?'o.is_test_order=1':'o.is_test_order=0'],p=[];if(search){where.push('(o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR a.house LIKE ? OR a.area LIKE ? OR a.city LIKE ? OR a.pincode LIKE ?)');const s=like(search);p.push(s,s,s,s,s,s,s)}if(customer){where.push('(o.customer_name LIKE ? OR o.customer_phone LIKE ? OR o.customer_id=?)');p.push(like(customer),like(customer),customer)}if(status&&status!=='all'){if(!STATUSES.includes(status))throw new Error('Invalid order status filter.');where.push(status==='New'?"o.delivery_status IN ('New','Ordered')":'o.delivery_status=?');if(status!=='New')p.push(status)}if(payment&&payment!=='all'){if(!PAYMENTS.includes(payment))throw new Error('Invalid payment status filter.');where.push('o.payment_status=?');p.push(payment)}if(plan&&plan!=='all'){where.push('o.delivery_plan=?');p.push(plan)}const fs=localDateStart(from),te=localDateEnd(to);if(fs){where.push('o.created_at>=?');p.push(fs)}if(te){where.push('o.created_at<=?');p.push(te)}if(minAmount&&Number.isFinite(Number(minAmount))){where.push('o.total>=?');p.push(Number(minAmount))}if(maxAmount&&Number.isFinite(Number(maxAmount))){where.push('o.total<=?');p.push(Number(maxAmount))}const base=`FROM orders o LEFT JOIN addresses a ON a.id=o.address_id LEFT JOIN order_address_snapshots s ON s.order_id=o.id WHERE ${where.join(' AND ')}`;const total=Number((await env.DB.prepare(`SELECT COUNT(*) count ${base}`).bind(...p).first())?.count||0);const rows=(await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.is_test_order,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.payment_collected_at,COALESCE(s.house_flat,a.house) house,COALESCE(s.area,a.area) area,COALESCE(s.city,a.city) city,COALESCE(s.pincode,a.pincode) pincode,COALESCE(s.landmark,a.landmark) landmark,COALESCE(s.delivery_note,a.note) note,s.recipient_name,s.delivery_phone,s.building,s.floor,s.street,s.locality,s.district,s.state,s.latitude,s.longitude,s.accuracy_meters,s.location_source,s.place_id,s.location_updated_at ${base} ORDER BY ${orderSort(u)} LIMIT ? OFFSET ?`).bind(...p,limit,offset).all()).results||[];if(!rows.length)return{orders:[],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}};const ids=rows.map(r=>r.id),ph=ids.map(()=>'?').join(',');const items=(await env.DB.prepare(`SELECT order_id,product_id,name,unit,qty,price,line_total FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...ids).all()).results||[];const map=new Map(rows.map(r=>[r.id,{id:r.id,customerId:r.customer_id,customer:{name:r.recipient_name||r.customer_name,phone:r.delivery_phone||r.customer_phone},address:{house:r.house,houseFlat:r.house,building:r.building,floor:r.floor,street:r.street,area:r.area,locality:r.locality,city:r.city,district:r.district,state:r.state,pincode:r.pincode,landmark:r.landmark,note:r.note,recipientName:r.recipient_name||r.customer_name,deliveryPhone:r.delivery_phone||r.customer_phone,latitude:r.latitude,longitude:r.longitude,accuracyMeters:r.accuracy_meters,locationSource:r.location_source,placeId:r.place_id,locationUpdatedAt:r.location_updated_at},items:[],isTestOrder:Number(r.is_test_order)===1,total:r.total,payment:r.payment_status,status:normalizeStatus(r.delivery_status),deliveryPlan:r.delivery_plan,createdAt:r.created_at,updatedAt:r.updated_at,paymentCollectedAt:r.payment_collected_at}]));for(const i of items)map.get(i.order_id)?.items.push({id:i.product_id,name:i.name,unit:i.unit,qty:i.qty,price:i.price,lineTotal:i.line_total});return{orders:[...map.values()],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}}}

export async function updateOrder(env,id,payload){
  const hasTestFlag=typeof payload.isTestOrder==='boolean';
  const current=await env.DB.prepare('SELECT delivery_status,payment_status,delivery_plan,customer_id,is_test_order,stock_release_token,stock_released_at FROM orders WHERE id=?').bind(id).first();
  if(!current)throw new Error('Order not found.');
  const {status,payment,deliveryPlan}=validateOrderPatch(current,payload);
  const currentStatus=normalizeStatus(n(current.delivery_status));
  const currentPayment=normalizePayment(current.payment_status);
  const currentTest=Number(current.is_test_order||0);
  const isTestOrder=hasTestFlag?(payload.isTestOrder?1:0):currentTest;
  const statusChanged=!!status&&status!==currentStatus;
  const paymentChanged=!!payment&&payment!==currentPayment;
  const planChanged=!!deliveryPlan&&deliveryPlan!==n(current.delivery_plan);
  const testClassificationChanged=hasTestFlag&&isTestOrder!==currentTest;
  if(!statusChanged&&!paymentChanged&&!planChanged&&!testClassificationChanged){
    return {ok:true,status:currentStatus,payment:currentPayment,deliveryPlan:current.delivery_plan,isTestOrder:currentTest,testClassificationChanged:false,noChange:true};
  }
  const sets=[],params=[],guards=['id=?'],guardParams=[id];
  if(statusChanged){sets.push('delivery_status=?');params.push(status);guards.push('delivery_status IS ?');guardParams.push(current.delivery_status)}
  if(paymentChanged){sets.push('payment_status=?');params.push(payment);if(payment==='Collected')sets.push('payment_collected_at=CURRENT_TIMESTAMP');guards.push('payment_status IS ?');guardParams.push(current.payment_status)}
  if(planChanged){sets.push('delivery_plan=?');params.push(deliveryPlan);guards.push('delivery_plan IS ?');guardParams.push(current.delivery_plan)}
  if(testClassificationChanged){sets.push('is_test_order=?');params.push(isTestOrder);guards.push('is_test_order IS ?');guardParams.push(currentTest)}
  let stockReleaseToken='';
  let reserved=[];
  if(statusChanged&&status==='Cancelled'){
    if(current.stock_release_token||current.stock_released_at)throw new Error('Order stock has already been released. Refresh the order before changing it.');
    const stock=(await env.DB.prepare('SELECT oi.product_id,SUM(oi.stock_reserved_qty) stock_reserved_qty,p.id product_exists FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? AND oi.stock_reserved_qty>0 GROUP BY oi.product_id,p.id').bind(id).all()).results||[];
    const missing=stock.find(item=>!item.product_exists);
    if(missing)throw new Error('Cannot cancel this order safely because a reserved product is missing: '+missing.product_id+'.');
    reserved=stock;
    stockReleaseToken=crypto.randomUUID();
    sets.push('stock_release_token=?');params.push(stockReleaseToken);
    sets.push('stock_released_at=CURRENT_TIMESTAMP');
    guards.push('stock_release_token IS NULL');
  }
  sets.push('updated_at=CURRENT_TIMESTAMP');
  const sql='UPDATE orders SET '+sets.join(',')+' WHERE '+guards.join(' AND ');
  const updateStatement=env.DB.prepare(sql).bind(...params,...guardParams);
  let updateResult;
  if(stockReleaseToken){
    // The conditional marker is written first. A competing cancellation has a different token,
    // so its stock-restoration statements become no-ops instead of double-incrementing stock.
    const statements=[updateStatement,...reserved.map(item=>env.DB.prepare(
      'UPDATE products SET stock_quantity=stock_quantity+? WHERE id=? AND EXISTS (SELECT 1 FROM orders WHERE id=? AND stock_release_token=? AND delivery_status=\'Cancelled\')'
    ).bind(Number(item.stock_reserved_qty),item.product_id,id,stockReleaseToken))];
    const results=await env.DB.batch(statements);
    updateResult=results?.[0];
    if(!updateResult?.meta?.changes)throw new Error('ORDER_CONFLICT: This order changed while you were saving. Refresh the order and try again.');
    const failedRestock=(results||[]).slice(1).find(result=>!result?.meta?.changes);
    if(failedRestock)throw new Error('Stock restoration did not complete for this cancellation. Stop further stock edits and reconcile the inventory.');
  }else{
    updateResult=await updateStatement.run();
    if(!updateResult.meta?.changes)throw new Error('ORDER_CONFLICT: This order changed while you were saving. Refresh the order and try again.');
  }
  return {ok:true,status:statusChanged?status:currentStatus,payment:paymentChanged?payment:currentPayment,deliveryPlan:planChanged?deliveryPlan:current.delivery_plan,isTestOrder,testClassificationChanged,noChange:false,stockReleased:Boolean(stockReleaseToken)}
}
