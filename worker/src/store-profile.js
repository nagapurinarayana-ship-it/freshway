const DEFAULT_STORE_PROFILE = Object.freeze({
  storeName: 'FreshWay',
  about: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  businessHours: '',
  deliveryInfo: '',
  shareTitle: 'FreshWay | Fresh Groceries & Everyday Essentials Delivered Locally',
  shareDescription: 'Shop fresh fruits, groceries and everyday essentials from FreshWay. Order online for local delivery with convenient cash payment.'
});

const LIMITS = Object.freeze({
  storeName: 120,
  about: 4000,
  phone: 40,
  whatsapp: 40,
  email: 200,
  address: 500,
  businessHours: 1500,
  deliveryInfo: 2500,
  shareTitle: 120,
  shareDescription: 300
});

const clean = (value, max) => String(value ?? '').trim().slice(0, max);

export function sanitizeStoreProfile(payload = {}, current = DEFAULT_STORE_PROFILE) {
  const base = { ...DEFAULT_STORE_PROFILE, ...current };
  return {
    storeName: clean(payload.storeName ?? base.storeName, LIMITS.storeName) || DEFAULT_STORE_PROFILE.storeName,
    about: clean(payload.about ?? base.about, LIMITS.about),
    phone: clean(payload.phone ?? base.phone, LIMITS.phone),
    whatsapp: clean(payload.whatsapp ?? base.whatsapp, LIMITS.whatsapp),
    email: clean(payload.email ?? base.email, LIMITS.email),
    address: clean(payload.address ?? base.address, LIMITS.address),
    businessHours: clean(payload.businessHours ?? base.businessHours, LIMITS.businessHours),
    deliveryInfo: clean(payload.deliveryInfo ?? base.deliveryInfo, LIMITS.deliveryInfo),
    shareTitle: clean(payload.shareTitle ?? base.shareTitle, LIMITS.shareTitle) || DEFAULT_STORE_PROFILE.shareTitle,
    shareDescription: clean(payload.shareDescription ?? base.shareDescription, LIMITS.shareDescription) || DEFAULT_STORE_PROFILE.shareDescription
  };
}

function fromRow(row) {
  return sanitizeStoreProfile({
    storeName: row?.store_name,
    about: row?.about,
    phone: row?.phone,
    whatsapp: row?.whatsapp,
    email: row?.email,
    address: row?.address,
    businessHours: row?.business_hours,
    deliveryInfo: row?.delivery_info,
    shareTitle: row?.share_title,
    shareDescription: row?.share_description
  });
}

export async function getStoreProfile(env) {
  const row = await env.DB.prepare('SELECT store_name,about,phone,whatsapp,email,address,business_hours,delivery_info,share_title,share_description FROM store_profile WHERE id=1 LIMIT 1').first();
  return fromRow(row);
}

export async function updateStoreProfile(env, payload = {}) {
  const current = await getStoreProfile(env);
  const profile = sanitizeStoreProfile(payload, current);
  await env.DB.prepare(
    'INSERT INTO store_profile (id,store_name,about,phone,whatsapp,email,address,business_hours,delivery_info,share_title,share_description,updated_at) VALUES (1,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET store_name=excluded.store_name,about=excluded.about,phone=excluded.phone,whatsapp=excluded.whatsapp,email=excluded.email,address=excluded.address,business_hours=excluded.business_hours,delivery_info=excluded.delivery_info,share_title=excluded.share_title,share_description=excluded.share_description,updated_at=CURRENT_TIMESTAMP'
  ).bind(
    profile.storeName,
    profile.about,
    profile.phone,
    profile.whatsapp,
    profile.email,
    profile.address,
    profile.businessHours,
    profile.deliveryInfo,
    profile.shareTitle,
    profile.shareDescription
  ).run();
  return profile;
}

export { DEFAULT_STORE_PROFILE };
