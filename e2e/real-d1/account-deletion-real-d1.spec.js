import { test } from '@playwright/test';

// The real-D1 account-deletion integration is intentionally registered in the
// final spec so its Owner alert and retained invoice cannot affect shared
// fixture assumptions in earlier UI tests.
test.skip('account deletion real-D1 integration runs last', () => {});
