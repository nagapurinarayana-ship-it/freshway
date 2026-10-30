import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migration = readFileSync(new URL('../migrations/0045_descriptive_home_promotion_alt_text.sql', import.meta.url), 'utf8');

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE home_promotions (
      id TEXT PRIMARY KEY,
      image_data TEXT,
      image_mime_type TEXT,
      alt_text TEXT NOT NULL DEFAULT '',
      display_order INTEGER NOT NULL DEFAULT 999,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function insert(db, row) {
  db.prepare(`
    INSERT INTO home_promotions
      (id, image_data, image_mime_type, alt_text, display_order, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.id, row.image_data, row.image_mime_type, row.alt_text, row.display_order, row.active);
}

test('0045 assigns distinct image-specific descriptions to the three observed active promotions only', () => {
  const db = database();
  try {
    insert(db, {
      id: 'promo-muzofq0q-rx6ie',
      image_data: 'banner-one-base64',
      image_mime_type: 'image/webp',
      alt_text: 'Buy 5ltr get ₹150 off',
      display_order: 1,
      active: 1
    });
    insert(db, {
      id: 'promo-muzofqx8-0774i',
      image_data: 'banner-two-base64',
      image_mime_type: 'image/webp',
      alt_text: 'Buy 5ltr get ₹150 off',
      display_order: 2,
      active: 1
    });
    insert(db, {
      id: 'promo-mvg9mrtf-5p0ae',
      image_data: 'banner-three-base64',
      image_mime_type: 'image/webp',
      alt_text: '',
      display_order: 3,
      active: 1
    });
    insert(db, {
      id: 'promo-unrelated',
      image_data: 'unrelated-base64',
      image_mime_type: 'image/webp',
      alt_text: 'An unrelated future promotion',
      display_order: 4,
      active: 1
    });

    db.exec(migration);

    const rows = db.prepare('SELECT * FROM home_promotions ORDER BY display_order').all();
    assert.deepEqual(rows.map(row => row.alt_text), [
      'FreshWay natural oils and pantry products with ₹50 off your first order.',
      'FreshWay 5-litre groundnut oil offer: ₹1,850, with ₹150 off.',
      'FreshWay wishes you a happy Dasara, with a festive diya, flowers and groundnut oil.',
      'An unrelated future promotion'
    ]);
    assert.equal(new Set(rows.map(row => row.alt_text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en'))).size, 4);
    assert.deepEqual(rows.map(row => row.image_data), [
      'banner-one-base64', 'banner-two-base64', 'banner-three-base64', 'unrelated-base64'
    ]);
    assert.deepEqual(rows.map(row => row.image_mime_type), Array(4).fill('image/webp'));
    assert.deepEqual(rows.map(row => row.active), [1, 1, 1, 1]);
    assert.deepEqual(rows.map(row => row.display_order), [1, 2, 3, 4]);

    // Re-applying the SQL cannot rewrite already corrected descriptions.
    const beforeRerun = rows.map(row => ({ id: row.id, alt_text: row.alt_text, image_data: row.image_data }));
    db.exec(migration);
    const afterRerun = db.prepare('SELECT id, alt_text, image_data FROM home_promotions ORDER BY display_order').all().map(row => ({ ...row }));
    assert.deepEqual(afterRerun, beforeRerun);
  } finally {
    db.close();
  }
});

test('0045 does not overwrite a newer Owner description when the observed legacy text no longer matches', () => {
  const db = database();
  try {
    insert(db, {
      id: 'promo-muzofq0q-rx6ie',
      image_data: 'owner-edited-base64',
      image_mime_type: 'image/webp',
      alt_text: 'Owner updated this description after the audit',
      display_order: 1,
      active: 1
    });
    db.exec(migration);
    const row = db.prepare('SELECT alt_text, image_data FROM home_promotions WHERE id=?').get('promo-muzofq0q-rx6ie');
    assert.equal(row.alt_text, 'Owner updated this description after the audit');
    assert.equal(row.image_data, 'owner-edited-base64');
  } finally {
    db.close();
  }
});
