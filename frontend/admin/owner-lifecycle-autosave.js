/*
 * Compatibility shim.
 *
 * The Owner order lifecycle UI is implemented exclusively by the root
 * owner-lifecycle.js controller. This file intentionally has no DOM
 * listeners, rendering, or save logic so two lifecycle controllers cannot
 * compete for the same order modal.
 */
(()=>{});
