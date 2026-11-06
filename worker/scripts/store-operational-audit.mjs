import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const n = value => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const yes = value => n(value) === 1 || value === true;
const present = value => value !== null && value !== undefined && String(value).trim() !== '';

export function readD1Rows(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  const batches = Array.isArray(raw) ? raw : [raw];
  return batches.flatMap(batch => Array.isArray(batch?.results) ? batch.results : []);
}

export function buildStoreOperationalAudit(matrixRows, orderRows = [], reservationRows = []) {
  if (!Array.isArray(matrixRows) || matrixRows.length === 0) {
    throw new Error('Production audit returned no store/product rows; refusing to report an empty database as healthy.');
  }
  const products = new Set(matrixRows.map(row => String(row.product_id)).filter(Boolean));
  const stores = new Map();

  for (const row of matrixRows) {
    const id = String(row.store_id || '');
    if (!id) throw new Error('Store/product audit row is missing store_id.');
    if (!stores.has(id)) stores.set(id, {
      id, name: String(row.store_name || id), active: yes(row.store_active),
      latitude: row.latitude == null ? null : n(row.latitude),
      longitude: row.longitude == null ? null : n(row.longitude),
      radiusKm: row.service_radius_km == null ? null : n(row.service_radius_km),
      catalogueRows: 0, missingCatalogueRows: 0, inventoryRows: 0,
      expectedInventoryRows: 0, missingInventoryRows: 0, unexpectedInventoryRows: 0,
      customerVisibleProducts: 0, locallyDisabledProducts: 0, hiddenByCentralCatalogue: 0,
      localPriceOverrides: [], invalidPrices: [], lowStock: [], outOfStock: []
    });

    const store = stores.get(id);
    const hasCatalogue = present(row.catalogue_store_id);
    const tracked = yes(row.stock_managed);
    const hasInventory = present(row.inventory_store_id);
    if (hasCatalogue) store.catalogueRows++;
    else store.missingCatalogueRows++;
    if (tracked) {
      store.expectedInventoryRows++;
      if (hasInventory) store.inventoryRows++;
      else store.missingInventoryRows++;
    } else if (hasInventory) store.unexpectedInventoryRows++;

    const centralActive = yes(row.product_active) && yes(row.category_active);
    const enabledHere = yes(row.store_product_available);
    const centralPrice = n(row.central_price);
    const override = row.price_override == null || row.price_override === '' ? null : n(row.price_override);
    const effectivePrice = override === null ? centralPrice : override;

    if (override !== null) store.localPriceOverrides.push({
      product: String(row.product_name || row.product_id),
      centralPrice, storePrice: override, differsFromCentral: override !== centralPrice,
      enabledHere
    });
    if (!Number.isSafeInteger(centralPrice) || centralPrice < 0 ||
        (override !== null && (!Number.isSafeInteger(override) || override < 0 || override > 10000000)) ||
        !Number.isSafeInteger(effectivePrice) || effectivePrice < 0) {
      store.invalidPrices.push({ product: String(row.product_name || row.product_id),
        centralPrice: row.central_price, priceOverride: row.price_override, effectivePrice: row.effective_price });
    }

    if (!centralActive) {
      if (enabledHere) store.hiddenByCentralCatalogue++;
      continue;
    }
    if (!enabledHere) {
      store.locallyDisabledProducts++;
      continue;
    }

    const available = Math.max(0, n(row.on_hand) - n(row.reserved_qty));
    if (!tracked || available > 0) {
      if (store.active) store.customerVisibleProducts++;
    }
    if (tracked) {
      const threshold = Math.max(0, n(row.low_stock_threshold));
      const item = { product: String(row.product_name || row.product_id),
        onHand: n(row.on_hand), reserved: n(row.reserved_qty), available,
        lowStockThreshold: threshold, storePrice: effectivePrice };
      if (available <= 0) store.outOfStock.push(item);
      else if (threshold > 0 && available <= threshold) store.lowStock.push(item);
    }
  }

  const storeReports = [...stores.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const store of storeReports) {
    store.storeConfigurationValid = Number.isFinite(store.latitude) &&
      Number.isFinite(store.longitude) && Math.abs(store.latitude) <= 90 &&
      Math.abs(store.longitude) <= 180 && Number.isFinite(store.radiusKm) &&
      store.radiusKm >= 0.1 && store.radiusKm <= 100;
    store.expectedCatalogueRows = products.size;
    store.inventoryComplete = store.missingInventoryRows === 0;
    store.catalogueComplete = store.missingCatalogueRows === 0;
  }

  const unavailableOrders = (orderRows || []).filter(row => !yes(row.assigned_store_active)).map(row => ({
    orderId: String(row.order_id), status: String(row.delivery_status || ''),
    storeId: row.assigned_store_id ?? null, storeName: row.assigned_store_name ?? null,
    reason: !present(row.assigned_store_id) ? 'unassigned' :
      (!present(row.assigned_store_name) ? 'assigned-store-missing' : 'assigned-store-inactive')
  }));
  const reservationMismatches = (reservationRows || []).map(row => ({
    orderId: String(row.order_id), productId: String(row.product_id),
    productName: String(row.product_name || row.product_id), status: String(row.delivery_status || ''),
    assignedStoreId: row.assigned_store_id ?? null,
    expectedReservedQty: n(row.expected_reserved_qty), actualReservedQty: n(row.actual_reserved_qty),
    actualStoreIds: String(row.actual_store_ids || ''), actualStoreCount: n(row.actual_store_count)
  }));

  const summary = {
    storeCount: storeReports.length,
    activeStores: storeReports.filter(store => store.active).length,
    inactiveStores: storeReports.filter(store => !store.active).length,
    productCount: products.size,
    missingCatalogueRows: storeReports.reduce((sum, store) => sum + store.missingCatalogueRows, 0),
    missingInventoryRows: storeReports.reduce((sum, store) => sum + store.missingInventoryRows, 0),
    unexpectedInventoryRows: storeReports.reduce((sum, store) => sum + store.unexpectedInventoryRows, 0),
    invalidStoreConfigurations: storeReports.filter(store => store.active && !store.storeConfigurationValid).length,
    invalidPriceRows: storeReports.reduce((sum, store) => sum + store.invalidPrices.length, 0),
    activeOrdersOnUnavailableStores: unavailableOrders.length,
    reservationMismatches: reservationMismatches.length,
    multiStoreReservationOrders: reservationMismatches.filter(row => row.actualStoreCount > 1).length,
    lowStockProducts: storeReports.reduce((sum, store) => sum + store.lowStock.length, 0),
    outOfStockProducts: storeReports.reduce((sum, store) => sum + store.outOfStock.length, 0)
  };

  const criticalIssues = [];
  if (summary.missingCatalogueRows) criticalIssues.push(summary.missingCatalogueRows + ' missing store catalogue rows');
  if (summary.missingInventoryRows) criticalIssues.push(summary.missingInventoryRows + ' missing store inventory rows');
  if (summary.invalidStoreConfigurations) criticalIssues.push(summary.invalidStoreConfigurations + ' active stores have invalid location/radius configuration');
  if (summary.invalidPriceRows) criticalIssues.push(summary.invalidPriceRows + ' invalid central/store prices');
  if (unavailableOrders.some(order => order.reason !== 'unassigned')) {
    criticalIssues.push('active orders are assigned to a missing or inactive store');
  }

  return {
    generatedAt: new Date().toISOString(), summary, stores: storeReports,
    activeOrdersOnUnavailableStores: unavailableOrders,
    reservationMismatches, criticalIssues, healthy: criticalIssues.length === 0
  };
}

export function renderStoreOperationalAuditMarkdown(report) {
  const s = report.summary;
  const lines = [
    '# FreshWay store-by-store production audit', '',
    'Generated: ' + report.generatedAt, '', '## Overall', '',
    '- Stores: ' + s.storeCount + ' (' + s.activeStores + ' active, ' + s.inactiveStores + ' inactive)',
    '- Products in central catalogue: ' + s.productCount,
    '- Missing store catalogue rows: ' + s.missingCatalogueRows,
    '- Missing stock-managed inventory rows: ' + s.missingInventoryRows,
    '- Unexpected inventory rows for untracked products: ' + s.unexpectedInventoryRows,
    '- Invalid active store configurations: ' + s.invalidStoreConfigurations,
    '- Invalid prices: ' + s.invalidPriceRows,
    '- Active orders on unavailable/unassigned stores: ' + s.activeOrdersOnUnavailableStores,
    '- Active-order reservation mismatches: ' + s.reservationMismatches,
    '- Multi-store reservation baskets: ' + s.multiStoreReservationOrders,
    '- Low-stock products: ' + s.lowStockProducts,
    '- Out-of-stock products: ' + s.outOfStockProducts, '', '## Store detail', ''
  ];
  for (const store of report.stores) {
    lines.push('### ' + store.name + ' (' + (store.active ? 'Active' : 'Inactive') + ')', '');
    lines.push('- Location: ' + (store.latitude ?? 'missing') + ', ' + (store.longitude ?? 'missing') + ' · radius ' + (store.radiusKm ?? 'missing') + ' km');
    lines.push('- Catalogue rows: ' + store.catalogueRows + '/' + store.expectedCatalogueRows + ' · missing ' + store.missingCatalogueRows);
    lines.push('- Inventory rows: ' + store.inventoryRows + '/' + store.expectedInventoryRows + ' · missing ' + store.missingInventoryRows);
    lines.push('- Customer-visible products: ' + store.customerVisibleProducts);
    lines.push('- Local overrides: ' + store.localPriceOverrides.length + ' · locally disabled ' + store.locallyDisabledProducts + ' · centrally hidden ' + store.hiddenByCentralCatalogue);
    lines.push('- Low stock: ' + store.lowStock.length + ' · out of stock: ' + store.outOfStock.length);
    if (store.localPriceOverrides.length) {
      lines.push('- Local prices:');
      for (const item of store.localPriceOverrides) {
        lines.push('  - ' + item.product + ': central ₹' + item.centralPrice + ', store ₹' + item.storePrice + (item.enabledHere ? '' : ' (disabled here)'));
      }
    }
    for (const item of store.lowStock) lines.push('- LOW: ' + item.product + ' — ' + item.available + ' available, ' + item.reserved + ' reserved, threshold ' + item.lowStockThreshold);
    for (const item of store.outOfStock) lines.push('- OUT: ' + item.product + ' — ' + item.onHand + ' on hand, ' + item.reserved + ' reserved');
    for (const issue of store.invalidPrices) lines.push('- INVALID PRICE: ' + issue.product);
    lines.push('');
  }
  if (report.activeOrdersOnUnavailableStores.length) {
    lines.push('## Active orders requiring store assignment review', '');
    for (const order of report.activeOrdersOnUnavailableStores.slice(0, 50)) {
      lines.push('- ' + order.orderId + ': ' + order.status + ' · ' + order.reason + ' · ' + (order.storeName || order.storeId || 'no store'));
    }
    lines.push('');
  }
  if (report.reservationMismatches.length) {
    lines.push('## Reservation inconsistencies requiring review', '');
    for (const row of report.reservationMismatches.slice(0, 50)) {
      lines.push('- ' + row.orderId + ' / ' + row.productName + ': expected ' + row.expectedReservedQty +
        ', actual ' + row.actualReservedQty + ', assigned ' + (row.assignedStoreId || 'none') +
        ', reservation stores ' + (row.actualStoreIds || 'none'));
    }
    lines.push('');
  }
  if (report.criticalIssues.length) {
    lines.push('## Critical issues', '');
    for (const issue of report.criticalIssues) lines.push('- ' + issue);
  } else lines.push('## Critical issues', '', 'None detected.');
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error('Usage: node scripts/store-operational-audit.mjs <matrix.json> <orders.json> <reservations.json>');
  const report = buildStoreOperationalAudit(readD1Rows(args[0]), readD1Rows(args[1]), readD1Rows(args[2]));
  const markdown = renderStoreOperationalAuditMarkdown(report);
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  if (!report.healthy) {
    console.error('Store operational audit found critical consistency issues: ' + report.criticalIssues.join('; '));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
}
