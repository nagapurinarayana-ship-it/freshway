-- Increment auth_version when credentials are reset so sessions issued with
-- an older credential version are rejected on the next request.
ALTER TABLE customers ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;
