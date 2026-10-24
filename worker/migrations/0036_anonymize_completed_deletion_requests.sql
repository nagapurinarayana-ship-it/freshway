-- Keep only aggregate completed-deletion metrics. Remove the per-request rows
-- and their identity links; active/rejected requests remain available for operations.
CREATE TABLE IF NOT EXISTS account_deletion_summary (
  id INTEGER PRIMARY KEY CHECK(id=1),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK(completed_count >= 0),
  latest_completed_at TEXT
);

INSERT INTO account_deletion_summary (id,completed_count,latest_completed_at)
SELECT 1,COUNT(*),MAX(processed_at)
FROM account_deletion_requests
WHERE status='completed'
HAVING COUNT(*) > 0;

DELETE FROM account_deletion_requests WHERE status='completed';
