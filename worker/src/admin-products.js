export async function deleteProduct(env,id){
  const p=await env.DB.prepare('SELECT id,name FROM products WHERE id=? LIMIT 1').bind(id).first();
  if(!p)throw new Error('Product not found.');
  const used=Number((await env.DB.prepare('SELECT COUNT(*) count FROM order_items WHERE product_id=?').bind(id).first())?.count||0);
  if(used)throw new Error('This product is part of existing orders. Hide it instead of deleting it.');
  const reservations=Number((await env.DB.prepare('SELECT COUNT(*) count FROM delivery_store_inventory_reservations WHERE product_id=?').bind(id).first())?.count||0);
  if(reservations)throw new Error('This product has delivery reservation history. Hide the product instead of deleting it.');
  // Store inventory rows restrict product deletion; clear only unreserved allocations atomically.
  const results=await env.DB.batch([
    env.DB.prepare('DELETE FROM delivery_store_inventory WHERE product_id=?').bind(id),
    env.DB.prepare('DELETE FROM products WHERE id=?').bind(id)
  ]);
  if(!results?.[1]?.meta?.changes)throw new Error('Product not found.');
  return{ok:true};
}