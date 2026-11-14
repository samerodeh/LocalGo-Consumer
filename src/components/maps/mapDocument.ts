import type { ThemePalette } from '../../theme/ThemeContext';

/** Only trusted theme tokens enter the document; user labels arrive as JSON. */
export function mapDocument(c: ThemePalette, dark: boolean) {
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
html,body,#map { height:100%; margin:0; background:${c.gray100}; }
.leaflet-control-zoom a { min-width:44px; min-height:44px; line-height:44px; }
.leaflet-marker-icon { transition:transform 600ms ease; }
.courier { width:30px; height:30px; border:3px solid ${c.onBrand}; border-radius:50%; display:flex; align-items:center; justify-content:center; background:${c.orange}; color:${c.onBrand}; }
.live { animation:location-pulse 2s infinite; }
@keyframes location-pulse { 50% { box-shadow:0 0 0 10px ${c.orange}22; } }
@media(prefers-reduced-motion:reduce) { .leaflet-marker-icon { transition:none; } .live { animation:none; } }
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onerror="window.ReactNativeWebView.postMessage(JSON.stringify({type:'error'}))"></script>
<script>
(function () {
  function post(data) { window.ReactNativeWebView.postMessage(JSON.stringify(data)); }
  try {
    var map = L.map('map', {zoomAnimation:false, fadeAnimation:false}).setView([45.496339,-73.578666],15);
    var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);
    if (${dark}) tiles.getContainer().style.filter = 'grayscale(1) invert(.9)';
    tiles.on('tileerror', function () { post({type:'error'}); });
    var group = L.layerGroup().addTo(map), courier = null, fitted = false;
    function emitPin(point) { post({type:'pin', latitude:point.lat, longitude:point.lng}); }
    function tooltip(marker, label) {
      var text = document.createElement('span'); text.textContent = label;
      marker.bindTooltip(text);
    }
    window.updatePoints = function (data) {
      group.clearLayers();
      var bounds = [];
      if (!data.points.some(function (p) {return p.kind === 'courier';}) && courier) { map.removeLayer(courier); courier = null; }
      data.points.forEach(function (p) {
        if (p.kind === 'courier') {
          var icon = L.divIcon({className:'', iconSize:[36,36], iconAnchor:[18,18],
            html:'<div class="courier '+(p.live?'live':'')+'"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2L3 21l9-5 9 5z"/></svg></div>'});
          if (!courier) courier = L.marker([p.latitude,p.longitude], {icon:icon}).addTo(map);
          else { courier.setIcon(icon); courier.setLatLng([p.latitude,p.longitude]); }
          tooltip(courier,p.label);
        } else {
          var color = p.kind === 'destination' ? '${c.brandNavy}' : '${c.orange}';
          var marker = L.circleMarker([p.latitude,p.longitude], {radius:8,color:color,fillColor:color,fillOpacity:.95,weight:3}).addTo(group);
          tooltip(marker,p.label);
        }
        bounds.push([p.latitude,p.longitude]);
      });
      if (data.pin) {
        var icon = L.divIcon({className:'',iconSize:[30,30],iconAnchor:[15,30],
          html:'<div style="width:24px;height:24px;border:3px solid ${c.onBrand};border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${c.orange}"></div>'});
        var marker = L.marker([data.pin.latitude,data.pin.longitude], {icon:icon,draggable:data.editable}).addTo(group);
        marker.on('dragend', function () { emitPin(marker.getLatLng()); });
        bounds.push([data.pin.latitude,data.pin.longitude]);
      }
      if (!fitted && bounds.length) { map.fitBounds(bounds,{padding:[40,40],maxZoom:16,animate:false}); fitted = true; }
      window.mapEditable = data.editable;
    };
    map.on('click', function (event) { if (window.mapEditable) emitPin(event.latlng); });
    post({type:'ready'});
  } catch (error) { post({type:'error'}); }
})();
</script></body></html>`;
}
