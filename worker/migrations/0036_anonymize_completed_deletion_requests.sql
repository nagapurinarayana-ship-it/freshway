-- Completed deletion requests must no longer point back to a customer or retain
-- user-entered notes/phone snapshots. Active and rejected requests preserve their
-- link while the customer account still exists or the request needs review.
CREATE TABLE account_deletion_requests_erasure_safe (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  phone_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','completed','rejected')),
  source TEXT NOT NULL CHECK(source IN ('authenticated_customer','external_verified_phone')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);

INSERT INTO account_deletion_requests_erasure_safe (
  id,customer_id,phone_snapshot,status,source,admin_note,created_at,updated_at,processed_at
)
SELECT
  id,
  CASE WHEN status='completed' THEN NULL ELSE customer_id END,
  CASE WHEN status='completed' THEN 'REDACTED' ELSE phone_snapshot END,
  status,
  source,
  CASE WHEN status='completed'
    THEN 'Completed: operational customer data redacted; applicable invoice/transaction records retained under approved tax/accounting retention.'
    ELSE admin_note
  END,
  created_at,updated_at,processed_at
FROM account_deletion_requests;

DROP TABLE account_deletion_requests;
ALTER TABLE account_deletion_requests_erasure_safe RENAME TO account_deletion_requests;

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status_created
  ON account_deletion_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_customer_created
  ON account_deletion_requests(customer_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_requests_one_active
  ON account_deletion_requests(customer_id) WHERE status IN ('pending','in_review');
