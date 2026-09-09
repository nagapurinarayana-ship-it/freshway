/*
 * Compatibility shim.
 *
 * The Owner order lifecycle UI is implemented exclusively by
 * frontend/admin/owner-lifecycle.js. This file intentionally has no DOM
 * listeners, rendering, or save logic so two lifecycle controllers cannot
 * compete for the same order modal.
 */
(()=>{});
