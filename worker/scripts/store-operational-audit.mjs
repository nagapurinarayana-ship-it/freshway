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

function distanceKm(aLat, aLng, bLat, bLng) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(x)));
}

function parseOrderItems(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function diagnoseUnassignedOrders(orderRows, matrixRows, storeReports, generatedAt, historyByOrder = new Map()) {
  const productsByStore = new Map();
  for (const row of matrixRows) {
    const storeId = String(row.store_id || '');
    const productId = String(row.product_id || '');
    if (!storeId || !productId) continue;
    if (!productsByStore.has(storeId)) productsByStore.set(storeId, new Map());
    productsByStore.get(storeId).set(productId, row);
  }

  const now = new Date(generatedAt).getTime();
  return (orderRows || []).map(row => {
    const items = parseOrderItems(row.items_json);
    const parsedLat = row.location_latitude == null ? NaN : Number(row.location_latitude);
    const parsedLng = row.location_longitude == null ? NaN : Number(row.location_longitude);
    const hasPin = Number.isFinite(parsedLat) && Number.isFinite(parsedLng) &&
      Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180;
    const createdAt = String(row.created_at || '');
    const createdMs = Date.parse(createdAt);
    const ageDays = Number.isFinite(createdMs) && Number.isFinite(now)
      ? Math.max(0, Math.floor((now - createdMs) / 86400000))
      : null;
    const basket = items.map(item => ({
      productId: String(item.productId || ''),
      product: String(item.name || item.productId || 'Unknown item'),
      quantity: n(item.qty),
      expectedStockReservationQty: n(item.stockReservedQty)
    }));
    const history = historyByOrder.get(String(row.order_id)) || [];
    const assignmentEvents = history.filter(event => [
      'delivery_date_change_approved',
      'fulfilment_store_reassigned',
      'fulfilment_store_stock_reconfirmed'
    ].includes(event.action));
    const lastAssignmentEvent = assignmentEvents.length ? assignmentEvents[assignmentEvents.length - 1] : null;
    const likelyUnassignmentCause = lastAssignmentEvent?.action === 'delivery_date_change_approved'
      ? 'approved-date-only-reschedule-cleared-store-assignment'
      : (lastAssignmentEvent ? 'store-assignment-event-recorded-needs-follow-up-review' : 'no-store-assignment-event-in-audit-history');

    const inRadius = [];
    const fulfilmentStores = [];
    const assessments = [];
    if (hasPin && basket.length) {
      for (const store of storeReports) {
        if (!store.active || !store.storeConfigurationValid) continue;
        const distance = distanceKm(parsedLat, parsedLng, store.latitude, store.longitude);
        if (distance > store.radiusKm) continue;
        inRadius.push(store.name);
        const productRows = productsByStore.get(store.id);
        const blockers = [];
        for (const item of basket) {
          const product = productRows?.get(item.productId);
          if (!product) {
            blockers.push({ product: item.product, reason: 'missing-store-catalogue-row' });
            continue;
          }
          if (!yes(product.product_active) || !yes(product.category_active)) {
            blockers.push({ product: item.product, reason: 'centrally-hidden-or-inactive' });
            continue;
          }
          if (!yes(product.store_product_available)) {
            blockers.push({ product: item.product, reason: 'disabled-at-store' });
            continue;
          }
          const available = Math.max(0, n(product.on_hand) - n(product.reserved_qty));
          if (yes(product.stock_managed) && available < item.quantity) {
            blockers.push({ product: item.product, reason: 'insufficient-stock', available, requested: item.quantity });
          }
        }
        assessments.push({ storeName: store.name, canFulfilWholeBasket: blockers.length === 0, blockers });
        if (blockers.length === 0) fulfilmentStores.push(store.name);
      }
    }

    let diagnosis;
    if (!hasPin) diagnosis = 'missing-delivery-pin';
    else if (!basket.length) diagnosis = 'missing-order-items';
    else if (!inRadius.length) diagnosis = 'no-active-store-within-delivery-radius';
    else if (!fulfilmentStores.length) diagnosis = 'no-single-in-radius-store-can-fulfil-whole-basket';
    else diagnosis = 'eligible-store-found-assignment-needs-manual-review';

    return {
      orderId: String(row.order_id),
      createdAt,
      ageDays,
      status: String(row.delivery_status || ''),
      paymentStatus: String(row.payment_status || ''),
      deliveryPlan: String(row.delivery_plan || ''),
      scheduledDeliveryDate: row.scheduled_delivery_date || null,
      itemCount: basket.length,
      items: basket,
      locationPinAvailable: hasPin,
      locationSource: String(row.location_source || 'missing'),
      inRadiusStoreCount: inRadius.length,
      inRadiusStores: inRadius,
      fulfilmentStores,
      storeAssessments: assessments,
      history,
      lastAssignmentEvent,
      likelyUnassignmentCause,
      diagnosis
    };
  });
}

export function buildStoreOperationalAudit(matrixRows, orderRows = [], reservationRows = [], historyRows = []) {
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
    const reportedEffective = n(row.effective_price);

    if (override !== null) store.localPriceOverrides.push({
      product: String(row.product_name || row.product_id),
      centralPrice, storePrice: override, differsFromCentral: override !== centralPrice,
      enabledHere
    });
    if (!Number.isSafeInteger(centralPrice) || centralPrice < 0 ||
        (override !== null && (!Number.isSafeInteger(override) || override < 0 || override > 10000000)) ||
        !Number.isSafeInteger(effectivePrice) || effectivePrice < 0 ||
        reportedEffective !== effectivePrice) {
      store.invalidPrices.push({ product: String(row.product_name || row.product_id),
        centralPrice: row.central_price, priceOverride: row.price_override, effectivePrice: row.effective_price });
    }

    const available = Math.max(0, n(row.on_hand) - n(row.reserved_qty));
    if (tracked) {
      const threshold = Math.max(0, n(row.low_stock_threshold));
      const item = { product: String(row.product_name || row.product_id),
        onHand: n(row.on_hand), reserved: n(row.reserved_qty), available,
        lowStockThreshold: threshold, storePrice: effectivePrice };
      if (available <= 0) store.outOfStock.push(item);
      else if (threshold > 0 && available <= threshold) store.lowStock.push(item);
    }

    if (!centralActive) {
      if (enabledHere) store.hiddenByCentralCatalogue++;
      continue;
    }
    if (!enabledHere) {
      store.locallyDisabledProducts++;
      continue;
    }
    if (store.active && (!tracked || available > 0)) store.customerVisibleProducts++;
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

  const auditTimestamp = new Date().toISOString();
  const unavailableOrders = (orderRows || []).map(row => ({
    orderId: String(row.order_id), status: String(row.delivery_status || ''),
    storeId: row.assigned_store_id ?? null, storeName: row.assigned_store_name ?? null,
    reason: !present(row.assigned_store_id) ? 'unassigned' :
      (!present(row.assigned_store_name) ? 'assigned-store-missing' : 'assigned-store-inactive')
  }));
  const orderEventHistory = (historyRows || []).map(row => ({
    orderId: String(row.order_id),
    createdAt: String(row.event_created_at || ''),
    actorType: String(row.actor_type || ''),
    action: String(row.action || ''),
    beforeStatus: row.before_delivery_status ?? null,
    afterStatus: row.after_delivery_status ?? null,
    beforeAssignedStoreId: row.before_assigned_store_id ?? null,
    afterAssignedStoreId: row.after_assigned_store_id ?? null,
    afterStoreId: row.after_store_id ?? null,
    afterStoreName: row.after_store_name ?? null,
    afterDate: row.after_date ?? null,
    afterScheduleStatus: row.after_schedule_status ?? null,
    requestStates: String(row.request_states || ''),
    operationalFlags: String(row.operational_flags || '')
  }));
  const historyByOrder = new Map();
  for (const event of orderEventHistory) {
    if (!historyByOrder.has(event.orderId)) historyByOrder.set(event.orderId, []);
    historyByOrder.get(event.orderId).push(event);
  }
  const orderDiagnostics = diagnoseUnassignedOrders(orderRows, matrixRows, storeReports, auditTimestamp, historyByOrder);
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
    outOfStockProducts: storeReports.reduce((sum, store) => sum + store.outOfStock.length, 0),
    ordersMissingLocationPin: orderDiagnostics.filter(order => !order.locationPinAvailable).length,
    ordersWithNoInRadiusStore: orderDiagnostics.filter(order => order.diagnosis === 'no-active-store-within-delivery-radius').length,
    ordersWithFulfilmentCandidate: orderDiagnostics.filter(order => order.fulfilmentStores.length > 0).length,
    ordersWithNoFullBasketStore: orderDiagnostics.filter(order =>
      order.locationPinAvailable && order.itemCount > 0 && order.inRadiusStoreCount > 0 && order.fulfilmentStores.length === 0
    ).length,
    ordersWithDateChangeApprovalAsLastStoreAction: orderDiagnostics.filter(order =>
      order.lastAssignmentEvent?.action === 'delivery_date_change_approved'
    ).length,
    ordersWithNoStoreAssignmentEvent: orderDiagnostics.filter(order => !order.lastAssignmentEvent).length
  };

  const criticalIssues = [];
  if (summary.missingCatalogueRows) criticalIssues.push(summary.missingCatalogueRows + ' missing store catalogue rows');
  if (summary.missingInventoryRows) criticalIssues.push(summary.missingInventoryRows + ' missing store inventory rows');
  if (summary.invalidStoreConfigurations) criticalIssues.push(summary.invalidStoreConfigurations + ' active stores have invalid location/radius configuration');
  if (summary.invalidPriceRows) criticalIssues.push(summary.invalidPriceRows + ' invalid central/store prices');
  if (summary.activeOrdersOnUnavailableStores) criticalIssues.push(summary.activeOrdersOnUnavailableStores + ' active orders have no active assigned store');
  if (summary.reservationMismatches) criticalIssues.push(summary.reservationMismatches + ' active-order stock reservation inconsistencies');

  return {
    generatedAt: auditTimestamp, summary, stores: storeReports,
    activeOrdersOnUnavailableStores: unavailableOrders,
    orderDiagnostics,
    orderEventHistory,
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
    '- Out-of-stock products: ' + s.outOfStockProducts,
    '- Unassigned orders missing a delivery pin: ' + s.ordersMissingLocationPin,
    '- Unassigned orders with no active store in radius: ' + s.ordersWithNoInRadiusStore,
    '- Unassigned orders with at least one whole-basket store candidate: ' + s.ordersWithFulfilmentCandidate,
    '- Unassigned orders with no whole-basket store candidate: ' + s.ordersWithNoFullBasketStore,
    '- Unassigned orders whose latest store action is a date-change approval: ' + s.ordersWithDateChangeApprovalAsLastStoreAction,
    '- Unassigned orders with no store assignment action in audit history: ' + s.ordersWithNoStoreAssignmentEvent,
    '', '## Store detail', ''
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
  if (report.orderDiagnostics.length) {
    lines.push('## Unassigned-order fulfilment diagnosis', '');
    for (const order of report.orderDiagnostics) {
      const age = order.ageDays === null ? 'age unknown' : order.ageDays + ' days old';
      const basket = order.items.map(item => item.product + ' ×' + item.quantity).join(', ') || 'items unavailable';
      const candidates = order.fulfilmentStores.length ? order.fulfilmentStores.join(', ') : 'none';
      lines.push('- ' + order.orderId + ': ' + order.status + ' · ' + age + ' · pin ' +
        (order.locationPinAvailable ? 'available' : 'missing') + ' · basket ' + basket +
        ' · in-radius stores ' + order.inRadiusStoreCount + ' · whole-basket candidates ' + candidates +
        ' · ' + order.diagnosis + ' · ' + order.likelyUnassignmentCause);
      if (order.history.length) {
        for (const event of order.history) {
          lines.push('  - History: ' + event.createdAt + ' · ' + event.actorType + ' · ' + event.action +
            (event.afterDate ? ' · date ' + event.afterDate : '') +
            (event.afterStoreName ? ' · store ' + event.afterStoreName : '') +
            (event.requestStates ? ' · requests ' + event.requestStates : '') +
            (event.operationalFlags ? ' · flags ' + event.operationalFlags : ''));
        }
      } else {
        lines.push('  - No order audit events recorded.');
      }
      for (const assessment of order.storeAssessments) {
        if (assessment.blockers.length) {
          const blockers = assessment.blockers.map(item => item.product + ':' + item.reason +
            (item.available === undefined ? '' : ' (' + item.available + '/' + item.requested + ')')).join(', ');
          lines.push('  - ' + assessment.storeName + ' blockers: ' + blockers);
        }
      }
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
  if (args.length !== 4) throw new Error('Usage: node scripts/store-operational-audit.mjs <matrix.json> <orders.json> <reservations.json> <order-history.json>');
  const report = buildStoreOperationalAudit(
    readD1Rows(args[0]), readD1Rows(args[1]), readD1Rows(args[2]), readD1Rows(args[3])
  );
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
