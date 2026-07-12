const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const SHIPBLU_API_KEY = process.env.SHIPBLU_API_KEY;

let counter = 0;
let lastReset = new Date().toDateString();
let zoneCache = null;
let zoneCacheTime = null;

function normalizeEgyptPhone(rawPhone) {
  var digits = (rawPhone || '').replace(/[^0-9+]/g, '');
  if (digits.startsWith('+20')) return digits;
  if (digits.startsWith('0020')) return digits;
  if (digits.startsWith('20') && digits.length === 12) return digits;
  if (digits.startsWith('01') && digits.length === 11) return digits;
  if (digits.startsWith('1') && digits.length === 10) return '0' + digits;
  return digits;
}

function sendToBosta(order) {
  return fetch('https://app.bosta.co/api/v2/deliveries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': BOSTA_API_KEY
    },
    body: JSON.stringify({
      type: 10,
      specs: { packageDetails: { weight: 1 } },
      receiver: {
        firstName: order.shipping_address?.first_name || 'Customer',
        lastName: order.shipping_address?.last_name || '',
        phone: order.shipping_address?.phone || order.phone || '',
      },
      dropOffAddress: {
        city: order.shipping_address?.city || 'Cairo',
        firstLine: order.shipping_address?.address1 || '',
      },
      businessReference: String(order.order_number),
      cod: parseFloat(order.total_price) || 0
    })
  }).then(function(res) {
    var contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return res.text().then(function(text) {
        console.log('Bosta non-JSON response (status ' + res.status + '):', text.substring(0, 300));
        return { success: false, nonJson: true, status: res.status };
      });
    }
    return res.json();
  }).then(function(data) {
    console.log('Bosta response:', JSON.stringify(data));
    return data;
  }).catch(function(err) {
    console.log('Bosta request failed:', err.message);
    return { success: false, error: err.message };
  });
}

async function buildZoneMap() {
  var map = {};
  try {
    var govRes = await fetch('https://api.shipblu.com/api/v1/governorates/', {
      headers: { 'Authorization': 'Api-Key ' + SHIPBLU_API_KEY }
    });
    var govData = await govRes.json();
    var governorates = govData.results || govData;

    for (var i = 0; i < governorates.length; i++) {
      var gov = governorates[i];
      var citiesRes = await fetch('https://api.shipblu.com/api/v1/governorates/' + gov.id + '/cities/', {
        headers: { 'Authorization': 'Api-Key ' + SHIPBLU_API_KEY }
      });
      var citiesData = await citiesRes.json();
      var cities = citiesData.results || citiesData;

      for (var j = 0; j < cities.length; j++) {
        var city = cities[j];
        var zonesRes = await fetch('https://api.shipblu.com/api/v1/cities/' + city.id + '/zones/', {
          headers: { 'Authorization': 'Api-Key ' + SHIPBLU_API_KEY }
        });
        var zonesData = await zonesRes.json();
        var zones = zonesData.results || zonesData;
        if (zones.length > 0) {
          var parts = city.name.split(' - ');
          var cleanCityName = parts[0].trim().toLowerCase();
          var cleanCityNameEn = parts[1] ? parts[1].trim().toLowerCase() : '';
          map[cleanCityName] = zones[0].id;
          if (cleanCityNameEn) map[cleanCityNameEn] = zones[0].id;
        }
      }
    }
    console.log('ShipBlu zone map built: ' + Object.keys(map).length + ' cities');
  } catch (err) {
    console.log('Failed to build ShipBlu zone map:', err.message);
  }
  return map;
}

async function getZoneId(cityName) {
  var now = Date.now();
  if (!zoneCache || !zoneCacheTime || (now - zoneCacheTime) > 24 * 60 * 60 * 1000) {
    zoneCache = await buildZoneMap();
    zoneCacheTime = now;
  }
  var key = (cityName || '').trim().toLowerCase();
  if (zoneCache[key]) return zoneCache[key];

  var keys = Object.keys(zoneCache);
  for (var i = 0; i < keys.length; i++) {
    if (key.includes(keys[i]) || keys[i].includes(key)) {
      return zoneCache[keys[i]];
    }
  }
  return null;
}

async function sendToShipBlu(order) {
  var cityName = order.shipping_address?.city || 'Cairo';
  var zoneId = await getZoneId(cityName);

  if (!zoneId) {
    console.log('ShipBlu: no zone match for city "' + cityName + '", order #' + order.order_number + ' — falling back to Bosta');
    return sendToBosta(order);
  }

  return fetch('https://api.shipblu.com/api/v1/delivery-orders/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Api-Key ' + SHIPBLU_API_KEY
    },
    body: JSON.stringify({
      customer: {
        full_name: (order.shipping_address?.first_name || '') + ' ' + (order.shipping_address?.last_name || ''),
        email: order.email || '',
        phone: normalizeEgyptPhone(order.shipping_address?.phone || order.phone || ''),
        address: {
          line_1: order.shipping_address?.address1 || '',
          line_2: order.shipping_address?.address2 || '',
          zone: zoneId
        }
      },
      packages: [{ package_size: 1 }],
      cod_amount: parseFloat(order.total_price) || 0,
      merchant_order_reference: String(order.order_number)
    })
  }).then(function(res) {
    var contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return res.text().then(function(text) {
        console.log('ShipBlu non-JSON response (status ' + res.status + '):', text.substring(0, 300));
        return { success: false, nonJson: true, status: res.status };
      });
    }
    return res.json();
  }).then(function(data) {
    console.log('ShipBlu response:', JSON.stringify(data));
    return data;
  }).catch(function(err) {
    console.log('ShipBlu request failed:', err.message);
    return { success: false, error: err.message };
  });
}

app.post('/webhook/order', function(req, res) {
  res.sendStatus(200);
  var today = new Date().toDateString();
  if (today !== lastReset) {
    counter = 0;
    lastReset = today;
  }
  counter++;
  var order = req.body;
  var city = ((order.shipping_address && order.shipping_address.city) || '').toLowerCase();
  var bostaOnlyCities = ['hurghada', 'الغردقة', 'red sea', 'al ghardaqah'];
  var slot = Math.ceil(counter / 10);
  var carrier = slot % 2 === 1 ? 'shipblu' : 'bosta';

  if (bostaOnlyCities.some(function(c) { return city.includes(c); })) {
    console.log('Order #' + order.order_number + ' → bosta (Hurghada - forced)');
    sendToBosta(order);
  } else if (carrier === 'bosta') {
    console.log('Order #' + order.order_number + ' → bosta (counter: ' + counter + ')');
    sendToBosta(order);
  } else {
    console.log('Order #' + order.order_number + ' → shipblu (counter: ' + counter + ')');
    sendToShipBlu(order);
  }
});

app.get('/', function(req, res) { res.send('Fulfillment Router Running ✅'); });

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
