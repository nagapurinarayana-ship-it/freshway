const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
const n=v=>String(v??'').trim();
const pageOf=u=>Math.max(1,Number(u.searchParams.get('page')||1)||1);
const limitOf=u=>Math.min(50,Math.max(1,Number(u.searchParams.get('limit')||25)||25));
const like=v=>`%${n(v)}%`;
const orderSort=u=>{const v=u.searchParams.get('sort')||'newest';if(v==='oldest')return'o.created_at ASC';if(v==='value-high')return'o.total DESC,o.created_at DESC';if(v==='value-low')return'o.total ASC,o.created_at DESC';if(v==='delivery')return"CASE o.delivery_plan WHEN 'Today' THEN 0 WHEN 'Tomorrow' THEN 1 WHEN 'Later' THEN 2 ELSE 3 END,o.created_at DESC";return'o.created_at DESC'};
async function orders(env,u){
 const page=pageOf(u),limit=limitOf(u),offset=(page-1)*limit,search=n(u.searchParams.get('search')),status=n(u.searchParams.get('status')),payment=n(u.searchParams.get('payment')),plan=n(u.searchParams.get('plan')),from=n(u.searchParams.get('from')),to=n(u.searchParams.get('to'));
 const where=['1=1'],p=[];
 if(search){where.push('(o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR a.house LIKE ? OR a.area LIKE ? OR a.city LIKE ? OR a.pincode LIKE ?)');const s=like(search);p.push(s,s,s,s,s,s,s)}
 if(status&&status!=='all'){where.push('o.delivery_status=?');p.push(status)}
 if(payment&&payment!=='all'){where.push('o.payment_status=?');p.push(payment)}
 if(plan&&plan!=='all'){where.push('o.delivery_plan=?');p.push(plan)}
 if(from){where.push('o.created_at>=?');p.push(`${from}T00:00:00`)}
 if(to){where.push('o.created_at<=?');p.push(`${to}T23:59:59`)}
 const base=`FROM orders o JOIN addresses a ON a.id=o.address_id WHERE ${where.join(' AND ')}`;
 const total=Number((await env.DB.prepare(`SELECT COUNT(*) count ${base}`).bind(...p).first())?.count||0);
 const rows=(await env.DB.prepare(`SELECT o.id,o.customer_id,o.customer_name,o.customer_phone,o.total,o.payment_status,o.delivery_status,o.delivery_plan,o.created_at,o.updated_at,o.payment_collected_at,a.house,a.area,a.city,a.pincode,a.landmark,a.note ${base} ORDER BY ${orderSort(u)} LIMIT ? OFFSET ?`).bind(...p,limit,offset).all()).results||[];
 if(!rows.length)return{orders:[],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}};
 const ids=rows.map(r=>r.id),ph=ids.map(()=>'?').join(',');
 const items=(await env.DB.prepare(`SELECT order_id,product_id,name,unit,qty,price,line_total FROM order_items WHERE order_id IN (${ph}) ORDER BY id`).bind(...ids).all()).results||[];
 const map=new Map(rows.map(r=>[r.id,{id:r.id,customerId:r.customer_id,customer:{name:r.customer_name,phone:r.customer_phone},address:{house:r.house,area:r.area,city:r.city,pincode:r.pincode,landmark:r.landmark,note:r.note},items:[],total:r.total,payment:r.payment_status,status:r.delivery_status,deliveryPlan:r.delivery_plan,createdAt:r.created_at,updatedAt:r.updated_at,paymentCollectedAt:r.payment_collected_at}]));
 for(const i of items)map.get(i.order_id)?.items.push({id:i.product_id,name:i.name,unit:i.unit,qty:i.qty,price:i.price,lineTotal:i.line_total});
 return{orders:[...map.values()],pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}}
}
async function customers(env,u){
 const page=pageOf(u),limit=limitOf(u),offset=(page-1)*limit,search=n(u.searchParams.get('search')),kind=n(u.searchParams.get('kind')),sort=n(u.searchParams.get('sort'))||'recent';
 const where=['1=1'],p=[];
 if(search){where.push('(c.name LIKE ? OR c.phone LIKE ? OR EXISTS(SELECT 1 FROM addresses ax WHERE ax.customer_id=c.id AND (ax.house LIKE ? OR ax.area LIKE ? OR ax.city LIKE ? OR ax.pincode LIKE ?)))');const s=like(search);p.push(s,s,s,s,s,s)}
 let having='';if(kind==='new')having=' HAVING COUNT(o.id)=1';if(kind==='repeat')having=' HAVING COUNT(o.id)>1';if(kind==='inactive')having=" HAVING MAX(o.created_at) < datetime('now','-30 day')";
 const order=sort==='orders'?'order_count DESC':sort==='spend'?'total_spend DESC':sort==='oldest'?'first_order ASC':'last_order DESC';
 const grouped=`FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE ${where.join(' AND ')} GROUP BY c.id`;
 const total=Number((await env.DB.prepare(`SELECT COUNT(*) count FROM (SELECT c.id ${grouped}${having})`).bind(...p).first())?.count||0);
 const rows=(await env.DB.prepare(`SELECT c.id,c.name,c.phone,COUNT(o.id) order_count,COALESCE(SUM(o.total),0) total_spend,MAX(o.created_at) last_order,MIN(o.created_at) first_order,COALESCE(MAX((SELECT ax.house||', '||ax.area||', '||ax.city||' - '||ax.pincode FROM addresses ax WHERE ax.customer_id=c.id)),'') address ${grouped}${having} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...p,limit,offset).all()).results||[];
 return{customers:rows.map(c=>({...c,orders:Number(c.order_count),total:Number(c.total_spend)})),pagination:{page,limit,total,pages:Math.max(1,Math.ceil(total/limit))}}
}
async function customer(env,id){
 const c=await env.DB.prepare('SELECT id,name,phone,whatsapp_opt_in,created_at,updated_at FROM customers WHERE id=?').bind(id).first();if(!c)throw new Error('Customer not found.');
 const orders=(await env.DB.prepare('SELECT id,total,payment_status,delivery_status,delivery_plan,created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all()).results||[];
 return{customer:{...c,orders:orders.map(o=>({...o,total:Number(o.total)}))}}
}
async function summary(env){
 const r=await env.DB.batch([
  env.DB.prepare("SELECT COUNT(*) count FROM orders WHERE delivery_status NOT IN ('Cancelled','Delivered')"),
  env.DB.prepare("SELECT COUNT(*) count FROM orders WHERE delivery_status='Ordered'"),
  env.DB.prepare("SELECT COUNT(*) count FROM orders WHERE delivery_status='Processing'"),
  env.DB.prepare("SELECT COUNT(*) count FROM orders WHERE delivery_status='Delivered'"),
  env.DB.prepare("SELECT COUNT(*) count FROM orders WHERE delivery_status NOT IN ('Delivered','Cancelled') AND delivery_plan='Today'"),
  env.DB.prepare("SELECT COALESCE(SUM(total),0) amount FROM orders WHERE payment_status='Pending' AND delivery_status!='Cancelled'"),
  env.DB.prepare('SELECT COUNT(*) count FROM customers'),env.DB.prepare('SELECT COUNT(*) count FROM products WHERE active=1'),env.DB.prepare('SELECT COUNT(*) count FROM products')
 ]);const v=r.map(x=>x.results?.[0]||{});return{newOrders:Number(v[1].count||0),processing:Number(v[2].count||0),pendingDelivery:Number(v[0].count||0),delivered:Number(v[3].count||0),deliveryToday:Number(v[4].count||0),cashPending:Number(v[5].amount||0),customers:Number(v[6].count||0),activeProducts:Number(v[7].count||0),products:Number(v[8].count||0)}
}
export async function handleAdminData(request,env){const u=new URL(request.url);try{if(u.pathname==='/api/admin/summary'&&request.method==='GET')return json(await summary(env));if(u.pathname==='/api/admin/orders'&&request.method==='GET')return json(await orders(env,u));if(u.pathname==='/api/admin/customers'&&request.method==='GET')return json(await customers(env,u));if(u.pathname.startsWith('/api/admin/customers/')&&request.method==='GET')return json(await customer(env,decodeURIComponent(u.pathname.split('/').pop())));return null}catch(e){return json({error:e?.message||'Admin data request failed.'},400)}}
