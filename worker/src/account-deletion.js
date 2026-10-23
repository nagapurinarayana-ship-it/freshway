// Fulfilment is separate from request submission. D1's batch keeps operational-data
// redaction and request completion atomic; issued invoice snapshots remain unchanged.
export async function fulfillAccountDeletion(env, requestId, adminNote) {
  const note = String(adminNote || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000);
  if (note.length < 20 || !/(invoice|transaction)/i.test(note) || !/(retain|retention|accounting|tax|legal)/i.test(note)) {
    return { ok: false, status: 400, error: 'Add a 20-character-or-longer note documenting the deletion work, the invoice/transaction records retained, and the retention basis.' };
  }
  const deletion = await env.DB.prepare('SELECT id,customer_id,phone_snapshot,status FROM account_deletion_requests WHERE id=? LIMIT 1').bind(requestId).first();
  if (!deletion) return { ok: false, status: 404, error: 'Deletion request not found.' };
  if (deletion.status === 'completed') return { ok: true, status: 'completed', alreadyCompleted: true };
  if (deletion.status !== 'in_review') return { ok: false, status: 409, error: 'Move the request to in review before completing deletion.' };
  const customer = await env.DB.prepare('SELECT id,phone,deleted_at FROM customers WHERE id=? LIMIT 1').bind(deletion.customer_id).first();
  if (!customer) return { ok: false, status: 409, error: 'The linked customer record no longer exists. Review this request manually.' };
  const customerId = String(deletion.customer_id);
  const phoneDigits = String(customer.phone || deletion.phone_snapshot || '').replace(/\D/g, '');
  const normalizedPhone = phoneDigits.length === 10 ? '91' + phoneDigits : phoneDigits.length === 12 && phoneDigits.startsWith('91') ? phoneDigits : '';
  const statements = [
    env.DB.prepare('DELETE FROM push_subscriptions WHERE customer_id=?').bind(customerId),
    env.DB.prepare('DELETE FROM notification_events WHERE customer_id=? OR order_id IN (SELECT id FROM orders WHERE customer_id=?)').bind(customerId, customerId),
    env.DB.prepare("UPDATE order_address_snapshots SET customer_id=NULL,address_id=NULL,recipient_name='Deleted customer',delivery_phone='',house_flat='Removed',building=NULL,floor=NULL,street=NULL,area='Removed',locality=NULL,city='Removed',district=NULL,state=NULL,pincode='000000',landmark=NULL,delivery_note=NULL,latitude=NULL,longitude=NULL,accuracy_meters=NULL,location_source=NULL,place_name=NULL,place_id=NULL,location_updated_at=NULL WHERE order_id IN (SELECT id FROM orders WHERE customer_id=?)").bind(customerId),
    env.DB.prepare("UPDATE addresses SET house='Removed',area='Removed',city='Removed',pincode='000000',landmark=NULL,note=NULL,label='Removed',recipient_name=NULL,delivery_phone=NULL,building=NULL,floor=NULL,street=NULL,locality=NULL,district=NULL,state=NULL,latitude=NULL,longitude=NULL,accuracy_meters=NULL,location_source=NULL,place_id=NULL,location_updated_at=NULL,is_default=0,deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP) WHERE customer_id=?").bind(customerId),
    env.DB.prepare("UPDATE orders SET customer_name='Deleted customer',customer_phone='',updated_at=CURRENT_TIMESTAMP WHERE customer_id=?").bind(customerId),
    env.DB.prepare("UPDATE customers SET name=NULL,phone=NULL,passcode_salt=NULL,passcode_hash=NULL,auth_version=COALESCE(auth_version,0)+1,whatsapp_opt_in=0,deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(customerId),
    env.DB.prepare("UPDATE account_deletion_requests SET status='completed',phone_snapshot='REDACTED',admin_note=?,updated_at=CURRENT_TIMESTAMP,processed_at=CURRENT_TIMESTAMP WHERE id=? AND status='in_review'").bind(note, requestId)
  ];
  if (normalizedPhone) statements.push(env.DB.prepare('DELETE FROM auth_rate_limits WHERE key IN (?,?,?,?,?,?)').bind(
    'auth:register:phone:' + normalizedPhone,
    'auth:login:phone:' + normalizedPhone,
    'auth:reset:start:phone:' + normalizedPhone,
    'auth:reset:complete:phone:' + normalizedPhone,
    'deletion:start:phone:' + normalizedPhone,
    'deletion:verify:phone:' + normalizedPhone
  ));
  await env.DB.batch(statements);
  return { ok: true, status: 'completed', alreadyCompleted: false };
}
