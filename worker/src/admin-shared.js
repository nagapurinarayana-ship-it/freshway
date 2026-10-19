export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
export const n=v=>String(v??'').trim();
export const pageOf=u=>Math.max(1,Number(u.searchParams.get('page')||1)||1);
export const limitOf=u=>Math.min(50,Math.max(1,Number(u.searchParams.get('limit')||25)||25));
export const like=v=>`%${n(v)}%`;
export const STATUSES=['New','Confirmed','Processing','Ready','Out for Delivery','Delivered','Cancelled'];
export const NEXT={New:['Confirmed','Cancelled'],Ordered:['Confirmed','Cancelled'],Confirmed:['Processing','Cancelled'],Processing:['Ready','Cancelled'],Ready:['Out for Delivery','Cancelled'],"Out for Delivery":['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
export const normalizeStatus=v=>v==='Ordered'?'New':v;
export const orderSort=u=>{const v=u.searchParams.get('sort')||'newest';if(v==='oldest')return'o.created_at ASC';if(v==='value-high')return'o.total DESC,o.created_at DESC';if(v==='value-low')return'o.total ASC,o.created_at DESC';if(v==='delivery')return"CASE o.delivery_plan WHEN 'Today' THEN 0 WHEN 'Tomorrow' THEN 1 WHEN 'Later' THEN 2 ELSE 3 END,o.created_at DESC";return'o.created_at DESC'};
export function utcForIstDate(y,m,d,h=0,min=0,s=0){return new Date(Date.UTC(y,m-1,d,h-5,min-30,s)).toISOString().slice(0,19)}
export function istParts(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x={};for(const z of p)x[z.type]=z.value;return{y:Number(x.year),m:Number(x.month),d:Number(x.day)}}
export function shiftDate(y,m,d,delta){const x=new Date(Date.UTC(y,m-1,d)+delta*86400000);return{y:x.getUTCFullYear(),m:x.getUTCMonth()+1,d:x.getUTCDate()}}
export function rangeBounds(u){const range=n(u.searchParams.get('range'))||'today',customFrom=n(u.searchParams.get('from')),customTo=n(u.searchParams.get('to'));let a=istParts(),sy=a.y,sm=a.m,sd=a.d,ey=a.y,em=a.m,ed=a.d;if(range==='7d'){const z=shiftDate(a.y,a.m,a.d,-6);sy=z.y;sm=z.m;sd=z.d}else if(range==='30d'){const z=shiftDate(a.y,a.m,a.d,-29);sy=z.y;sm=z.m;sd=z.d}else if(range==='custom'&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(customFrom)){const q=customFrom.split('-').map(Number);sy=q[0];sm=q[1];sd=q[2];if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(customTo)){const r=customTo.split('-').map(Number);ey=r[0];em=r[1];ed=r[2]}else{ey=sy;em=sm;ed=sd}}return{start:utcForIstDate(sy,sm,sd),end:utcForIstDate(ey,em,ed,23,59,59),label:range==='today'?'Today':range==='7d'?'Last 7 days':range==='30d'?'Last 30 days':'Custom'}}
export function localDateStart(v){if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v))return null;const [y,m,d]=v.split('-').map(Number);return utcForIstDate(y,m,d)}
export function localDateEnd(v){if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v))return null;const [y,m,d]=v.split('-').map(Number);return utcForIstDate(y,m,d,23,59,59)}

export const PAYMENTS=['Not Collected','Collected','Refunded','Cancelled'];
export const DELIVERY_PLANS=['Today','Tomorrow','Later','Unscheduled'];
export const normalizePaymentStatus=value=>{const payment=n(value);return payment==='Pending'?'Not Collected':payment};
export const normalizePaymentFilter=normalizePaymentStatus;

/**
 * One lifecycle/payment policy shared by Owner and the legacy compatibility API.
 * Database writes still perform compare-and-set checks; this function validates transitions.
 */
export function validateOrderPatch(current,payload={}){
  const status=payload.status?normalizeStatus(n(payload.status)):'';
  const payment=payload.payment?normalizePaymentStatus(payload.payment):'';
  const deliveryPlan=n(payload.deliveryPlan);
  if(status&&!STATUSES.includes(status))throw new Error('Invalid delivery status.');
  if(payment&&!PAYMENTS.includes(payment))throw new Error('Invalid payment status.');
  if(deliveryPlan&&!DELIVERY_PLANS.includes(deliveryPlan))throw new Error('Invalid delivery plan.');

  const currentStatus=normalizeStatus(n(current.delivery_status));
  const currentPayment=normalizePaymentStatus(current.payment_status);
  if(status&&status!==currentStatus&&!NEXT[currentStatus]?.includes(status)){
    throw new Error('Cannot change '+currentStatus+' order to '+status+'.');
  }
  const nextStatus=status||currentStatus;
  if(deliveryPlan&&(['Delivered','Cancelled'].includes(currentStatus)||['Delivered','Cancelled'].includes(nextStatus))){
    throw new Error('Delivery plan cannot be changed after an order is completed or cancelled.');
  }
  if(payment==='Collected'&&nextStatus!=='Delivered')throw new Error('Cash can be marked collected only after delivery.');
  if(payment==='Refunded'&&currentPayment!=='Collected')throw new Error('Only collected payments can be refunded.');
  if(payment==='Cancelled'&&nextStatus!=='Cancelled')throw new Error('Payment can be cancelled only for a cancelled order.');
  if(currentPayment==='Collected'&&payment&&payment!=='Collected'&&payment!=='Refunded'){
    throw new Error('Collected cash cannot be changed to an unpaid or cancelled payment.');
  }
  if(currentPayment==='Refunded'&&payment&&payment!=='Refunded'){
    throw new Error('Refunded payments cannot be changed back to another payment state.');
  }
  if(currentPayment==='Cancelled'&&payment&&payment!=='Cancelled'){
    throw new Error('Cancelled payments cannot be changed back to another payment state.');
  }
  return {status,payment,deliveryPlan};
}
