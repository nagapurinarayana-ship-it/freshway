/* FreshWay Owner Serviceable Areas administration.
 * Leaflet/OSM boundary drawing reuses the map stack already used by FreshWay.
 */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  let api = null, state = null, map = null, boundaryLayer = null, pointLayers = [], drawing = false, drawPoints = [], mapReady = false;

  const esc = value => String(value == null ? '' : value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const pinList = value => Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/).map(v => v.trim()).filter(Boolean);
  const isCoordinates = (lat, lon) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180 && !(Number(lat) === 0 && Number(lon) === 0);
  function toast(message) {
    const node = $('#toast');
    if (node) { node.textContent = message; node.classList.add('show'); clearTimeout(window.__toast); window.__toast = setTimeout(() => node.classList.remove('show'), 3000); }
  }
  function setStatus(message, error = false) {
    const node = $('#serviceabilityStatus');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('is-error', !!error);
    node.classList.toggle('is-ok', !error && !!message);
  }
  function coverageLabel(zone) {
    return ({pincode:'PIN-code',polygon:'Map boundary',hybrid:'PIN + map'})[zone.coverageMode] || zone.coverageMode;
  }
  function modeLabel(mode) {
    return ({off:'Off — legacy behaviour',shadow:'Shadow — observe only',enforced:'Enforced — block unserviceable orders'})[mode] || mode;
  }
  function render() {
    if (!state) return;
    const summary = $('#serviceabilitySummary');
    if (summary) {
      const s = state.summary || {};
      summary.innerHTML = [
        ['Active zones', s.active || 0],
        ['Paused', s.paused || 0],
        ['Draft', s.draft || 0],
        ['Config version', state.settings?.configVersion || 1]
      ].map(([label,value]) => '<article class="serviceability-kpi"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>').join('');
    }
    const list = $('#serviceabilityZoneList');
    if (list) list.innerHTML = state.zones?.length ? state.zones.map(zone => {
      const statusClass = zone.status === 'active' ? 'active' : (zone.status === 'paused' ? 'paused' : 'draft');
      const detail = zone.coverageMode === 'polygon' ? 'Map boundary' : zone.coverageMode === 'hybrid' ? 'Hybrid PIN and map' : 'PIN codes';
      const pins = (zone.pinCodes || []).join(', ');
      return '<article class="serviceability-zone-card">'+
        '<div class="serviceability-zone-head"><div><strong>'+esc(zone.name)+'</strong><span>'+esc(zone.customerLabel || 'No customer label')+'</span></div><span class="serviceability-status-chip '+statusClass+'">'+esc(zone.status)+'</span></div>'+
        '<div class="serviceability-zone-meta"><span>'+esc(detail)+'</span><span>Priority '+esc(zone.priority)+'</span></div>'+
        (pins ? '<p class="serviceability-zone-pins">'+esc(pins)+'</p>' : '')+
        (zone.allowPinFallback ? '<p class="serviceability-zone-note">PIN fallback enabled when coordinates are unavailable.</p>' : '')+
        '<div class="serviceability-zone-actions"><button type="button" data-zone-edit="'+esc(zone.id)+'">Edit</button>'+
        (zone.status === 'active' ? '<button type="button" data-zone-status="paused" data-zone-id="'+esc(zone.id)+'">Pause</button>' : zone.status === 'paused' || zone.status === 'draft' ? '<button type="button" data-zone-status="active" data-zone-id="'+esc(zone.id)+'">Activate</button>' : '')+
        (zone.status !== 'archived' ? '<button type="button" class="danger" data-zone-status="archived" data-zone-id="'+esc(zone.id)+'">Archive</button>' : '')+
        '</div></article>';
    }).join('') : '<div class="empty">No delivery zones yet. Create a draft zone to get started.</div>';
    const mode = $('#serviceabilityMode');
    if (mode && state.settings) mode.value = state.settings.enforcementMode || 'off';
  }

  async function load(options = {}) {
    if (options.api) api = options.api;
    if (!api) return;
    setStatus('Loading serviceability settings…');
    try {
      state = await api('/admin/serviceability');
      render();
      setStatus('Configuration loaded. Changes are saved only when you choose Save, Activate or Pause.');
    } catch (error) {
      setStatus(error.message || 'Could not load serviceability configuration.', true);
      throw error;
    }
  }

  function currentFormZone() {
    const polygonText = $('#serviceabilityPolygonJson')?.value.trim() || '';
    let polygon = null;
    if (polygonText) {
      try { polygon = JSON.parse(polygonText); }
      catch (_) { throw new Error('The map boundary is invalid. Clear it and draw the boundary again.'); }
    }
    return {
      name: $('#serviceabilityZoneName')?.value.trim() || '',
      customerLabel: $('#serviceabilityZoneLabel')?.value.trim() || '',
      coverageMode: $('#serviceabilityCoverageMode')?.value || 'pincode',
      status: $('#serviceabilityZoneStatus')?.value || 'draft',
      priority: Number($('#serviceabilityPriority')?.value || 0),
      pinCodes: pinList($('#serviceabilityPincodes')?.value || ''),
      polygon,
      allowPinFallback: $('#serviceabilityAllowPinFallback')?.checked || false,
      unavailableMessage: $('#serviceabilityUnavailableMessage')?.value.trim() || '',
      internalNote: $('#serviceabilityInternalNote')?.value.trim() || ''
    };
  }
  function setFormZone(zone = null) {
    const form = $('#serviceabilityZoneFormInner');
    if (!form) return;
    form.reset();
    $('#serviceabilityZoneId').value = zone?.id || '';
    $('#serviceabilityZoneName').value = zone?.name || '';
    $('#serviceabilityZoneLabel').value = zone?.customerLabel || '';
    $('#serviceabilityCoverageMode').value = zone?.coverageMode || 'pincode';
    $('#serviceabilityZoneStatus').value = zone?.status || 'draft';
    $('#serviceabilityPriority').value = String(zone?.priority ?? 0);
    $('#serviceabilityPincodes').value = (zone?.pinCodes || []).join(', ');
    $('#serviceabilityAllowPinFallback').checked = !!zone?.allowPinFallback;
    $('#serviceabilityUnavailableMessage').value = zone?.unavailableMessage || '';
    $('#serviceabilityInternalNote').value = zone?.internalNote || '';
    $('#serviceabilityPolygonJson').value = zone?.polygon ? JSON.stringify(zone.polygon) : '';
    $('#serviceabilityZoneFormTitle').textContent = zone ? 'Edit delivery zone' : 'Create delivery zone';
    $('#serviceabilityZoneSave').textContent = zone ? 'Save zone' : 'Create zone';
    $('#serviceabilityZoneForm').hidden = false;
    updateCoverageFields();
    if ($('#serviceabilityCoverageMode').value !== 'pincode') void initMap(zone?.polygon || null);
    else destroyMap();
    $('#serviceabilityZoneFormTitle').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function polygonFromField() { try { return JSON.parse($('#serviceabilityPolygonJson')?.value || 'null'); } catch (_) { return null; } }
  function updateCoverageFields() {
    const mode = $('#serviceabilityCoverageMode')?.value || 'pincode';
    const pinWrap = $('#serviceabilityPincodeField');
    const mapWrap = $('#serviceabilityMapField');
    const fallbackWrap = $('#serviceabilityFallbackField');
    if (pinWrap) pinWrap.hidden = mode === 'polygon';
    if (mapWrap) mapWrap.hidden = mode === 'pincode';
    if (fallbackWrap) fallbackWrap.hidden = mode !== 'hybrid';
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (window.__freshwayLeafletLoad) return window.__freshwayLeafletLoad;
    window.__freshwayLeafletLoad = new Promise((resolve, reject) => {
      if (!document.querySelector('link[data-fw-serviceability-leaflet]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        css.dataset.fwServiceabilityLeaflet = '1';
        document.head.appendChild(css);
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => { window.__freshwayLeafletLoad = null; reject(new Error('Map library could not load. You can still configure PIN-code zones.')); };
      document.head.appendChild(script);
    });
    return window.__freshwayLeafletLoad;
  }
  function clearBoundaryLayers() {
    if (map && boundaryLayer) map.removeLayer(boundaryLayer);
    boundaryLayer = null;
    pointLayers.forEach(layer => { if (map) map.removeLayer(layer); });
    pointLayers = [];
  }
  function drawStoredPolygon(polygon) {
    clearBoundaryLayers();
    if (!map || !polygon) return;
    const coordinates = polygon.type === 'Polygon' ? [polygon.coordinates] : polygon.coordinates;
    const latLngs = [];
    coordinates.forEach(poly => {
      (poly || []).forEach(ring => {
        const points = (ring || []).map(pair => [Number(pair[1]), Number(pair[0])]);
        if (points.length >= 4) latLngs.push(points);
      });
    });
    if (!latLngs.length) return;
    boundaryLayer = window.L.polygon(latLngs, {color:'#0f7a4b',weight:3,fillOpacity:0.15}).addTo(map);
    try { map.fitBounds(boundaryLayer.getBounds(), {padding:[18,18],maxZoom:15}); } catch (_) {}
  }
  async function initMap(polygon = null) {
    const element = $('#serviceabilityZoneMap');
    if (!element) return;
    try {
      await loadLeaflet();
      if (!document.contains(element) || element.offsetParent === null) return;
      if (!map) {
        let center = [17.6082,79.1091];
        try {
          const profile = await api('/admin/store-profile');
          if (isCoordinates(profile?.storeProfile?.shopLatitude,profile?.storeProfile?.shopLongitude)) {
            center = [Number(profile.storeProfile.shopLatitude),Number(profile.storeProfile.shopLongitude)];
          }
        } catch (_) {}
        map = window.L.map(element).setView(center, 12);
        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
        map.on('click', event => {
          if (!drawing) return;
          drawPoints.push([event.latlng.lng,event.latlng.lat]);
          const layer = window.L.circleMarker(event.latlng,{radius:5,color:'#0f7a4b',fillOpacity:1}).addTo(map);
          pointLayers.push(layer);
          renderDrawStatus();
        });
      } else {
        clearBoundaryLayers();
        map.setView([17.6082,79.1091],12);
      }
      mapReady = true;
      drawStoredPolygon(polygon);
      $('#serviceabilityMapStatus').textContent = 'Tap Start drawing, then tap at least three points around the service boundary. Finish by tapping the first point or use Complete boundary.';
      setTimeout(() => map?.invalidateSize(), 50);
    } catch (error) {
      setStatus(error.message || 'Map unavailable.', true);
      const mapNode = $('#serviceabilityZoneMap');
      if (mapNode) mapNode.innerHTML = '<p class="serviceability-map-fallback">The boundary map is unavailable. PIN-code configuration still works; try the map again later.</p>';
    }
  }
  function renderDrawStatus() {
    const node = $('#serviceabilityMapStatus');
    if (node) node.textContent = drawing ? 'Drawing boundary: ' + drawPoints.length + ' point(s) selected.' : 'Boundary has ' + drawPoints.length + ' point(s).';
  }
  function startDrawing() {
    if (!mapReady || !map) { toast('Please wait for the map to finish loading, then start drawing.'); return; }
    drawing = true; drawPoints = []; clearBoundaryLayers();
    const node=$('#serviceabilityMapStatus'); if(node) node.textContent='Tap the map to add boundary points. Select Complete boundary when finished.';
    toast('Boundary drawing started. Tap the map to add points.');
  }
  function completeDrawing() {
    if (!drawing) return;
    if (drawPoints.length > 1 && Math.abs(drawPoints[0][0]-drawPoints[drawPoints.length-1][0]) < 1e-8 && Math.abs(drawPoints[0][1]-drawPoints[drawPoints.length-1][1]) < 1e-8) drawPoints.pop();
    if (drawPoints.length < 3) { toast('Add at least three different boundary points.'); return; }
    const ring = drawPoints.map(point => [point[0],point[1]]);
    ring.push([...ring[0]]);
    const polygon = {type:'Polygon',coordinates:[ring]};
    $('#serviceabilityPolygonJson').value = JSON.stringify(polygon);
    drawing = false;
    clearBoundaryLayers();
    boundaryLayer = window.L.polygon(ring.map(point=>[point[1],point[0]]),{color:'#0f7a4b',weight:3,fillOpacity:0.15}).addTo(map);
    try { map.fitBounds(boundaryLayer.getBounds(),{padding:[18,18]}); } catch (_) {}
    $('#serviceabilityMapStatus').textContent='Boundary captured. Save the zone to keep it. For hybrid zones, coordinates override PIN fallback when coordinates are present.';
    toast('Map boundary captured.');
  }
  function clearPolygon() {
    drawing = false; drawPoints = []; clearBoundaryLayers();
    const json=$('#serviceabilityPolygonJson'); if(json) json.value='';
    const node=$('#serviceabilityMapStatus'); if(node) node.textContent='No boundary selected.';
  }
  function destroyMap() {
    drawing = false; drawPoints = []; mapReady = false; clearBoundaryLayers();
    if (map) { map.remove(); map = null; }
    const element=$('#serviceabilityZoneMap');
    if(element) element.innerHTML='';
  }

  async function saveZone(event) {
    event?.preventDefault();
    if (!api) return;
    const button=$('#serviceabilityZoneSave');
    if (button) { button.disabled=true; button.textContent='Saving…'; }
    try {
      const payload=currentFormZone();
      const id=$('#serviceabilityZoneId').value;
      const result=id ? await api('/admin/serviceability/zones/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(payload)}) :
        await api('/admin/serviceability/zones',{method:'POST',body:JSON.stringify(payload)});
      state=result;
      render();
      $('#serviceabilityZoneForm').hidden=true;
      destroyMap();
      setStatus('Delivery zone saved. Enforcement is controlled separately below.');
      toast('Delivery zone saved.');
    } catch (error) {
      setStatus(error.message || 'Could not save delivery zone.',true);
      toast(error.message || 'Could not save delivery zone.');
    } finally {
      if(button) { button.disabled=false; button.textContent=$('#serviceabilityZoneId')?.value ? 'Save zone' : 'Create zone'; }
    }
  }
  async function saveMode() {
    const button=$('#serviceabilityModeSave');
    if (button) { button.disabled=true; button.textContent='Saving…'; }
    try {
      state=await api('/admin/serviceability/settings',{method:'PATCH',body:JSON.stringify({enforcementMode:$('#serviceabilityMode').value})});
      render();
      setStatus('Enforcement mode saved: '+modeLabel(state.settings.enforcementMode)+'.');
      toast('Serviceability mode saved.');
    } catch (error) {
      if (state?.settings) $('#serviceabilityMode').value=state.settings.enforcementMode;
      setStatus(error.message || 'Could not change enforcement mode.',true);
      toast(error.message || 'Could not change enforcement mode.');
    } finally { if(button){button.disabled=false;button.textContent='Save mode'} }
  }
  async function changeZoneStatus(id,status) {
    const zone=state?.zones?.find(item=>String(item.id)===String(id));
    if(!zone)return;
    if(status==='archived'&&!window.confirm('Archive this zone? Historical order snapshots will remain available.'))return;
    try {
      state=await api('/admin/serviceability/zones/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({...zone,status})});
      render();setStatus('Zone '+status+'.');toast('Zone '+status+'.');
    } catch(error) { setStatus(error.message||'Could not update zone.',true);toast(error.message||'Could not update zone.') }
  }
  async function testDestination(event) {
    event?.preventDefault();
    const button=$('#serviceabilityTestButton');
    if(button){button.disabled=true;button.textContent='Checking…'}
    const output=$('#serviceabilityTestResult');
    if(output)output.textContent='Checking delivery availability…';
    try {
      const address={pincode:$('#serviceabilityTestPincode').value.trim()};
      const lat=$('#serviceabilityTestLatitude').value.trim(),lon=$('#serviceabilityTestLongitude').value.trim();
      if(lat || lon){if(!lat||!lon||!isCoordinates(lat,lon))throw new Error('Enter a complete valid latitude and longitude pair.');address.latitude=Number(lat);address.longitude=Number(lon)}
      const result=await api('/admin/serviceability/test',{method:'POST',body:JSON.stringify({address})});
      if(output)output.textContent=result.decision.message+' Result: '+result.decision.code+(result.decision.winnerZoneName?' · Zone: '+result.decision.winnerZoneName:'')+'. Mode: '+result.settings.enforcementMode+'.';
      setStatus('Test completed. It does not create or modify an order.');
    } catch(error) { if(output)output.textContent=error.message||'Could not test this destination.';setStatus(error.message||'Could not test this destination.',true) }
    finally { if(button){button.disabled=false;button.textContent='Check address'} }
  }
  function bind() {
    $('#serviceabilityModeSave')?.addEventListener('click',saveMode);
    $('#serviceabilityNewZone')?.addEventListener('click',()=>setFormZone());
    const cancelForm=()=>{ $('#serviceabilityZoneForm').hidden=true;destroyMap(); };
    $('#serviceabilityZoneCancel')?.addEventListener('click',cancelForm);
    $('#serviceabilityZoneCancelBottom')?.addEventListener('click',cancelForm);
    $('#serviceabilityZoneFormInner')?.addEventListener('submit',saveZone);
    $('#serviceabilityCoverageMode')?.addEventListener('change',()=>{updateCoverageFields();if($('#serviceabilityCoverageMode').value!=='pincode')void initMap(polygonFromField());else destroyMap();});
    $('#serviceabilityDrawBoundary')?.addEventListener('click',startDrawing);
    $('#serviceabilityCompleteBoundary')?.addEventListener('click',completeDrawing);
    $('#serviceabilityClearBoundary')?.addEventListener('click',clearPolygon);
    $('#serviceabilityTestForm')?.addEventListener('submit',testDestination);
    $('#serviceabilityZoneList')?.addEventListener('click',event=>{
      const target=event.target instanceof Element?event.target:null;if(!target)return;
      const edit=target.closest('[data-zone-edit]');if(edit){const zone=state?.zones?.find(item=>String(item.id)===edit.dataset.zoneEdit);if(zone)setFormZone(zone);return}
      const action=target.closest('[data-zone-status]');if(action)void changeZoneStatus(action.dataset.zoneId,action.dataset.zoneStatus);
    });
    $('#serviceabilityAllowPinFallback')?.addEventListener('change',()=>{});
  }
  bind();
  window.FreshWayOwnerServiceableAreas=Object.freeze({load,refresh:()=>load({api}),createNew:()=>setFormZone()});
})();