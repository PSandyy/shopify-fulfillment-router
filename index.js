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
  }).then(function(res) { return res.json(); })
    .then(function(data) { console.log('Bosta response:', JSON.stringify(data)); });
}

function sendToShipBlu(order) {
  return fetch('https://api.shipblu.com/api/v1/merchant/shipments/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SHIPBLU_API_KEY
    },
    body: JSON.stringify({
      address: {
        city: order.shipping_address?.city || 'Cairo',
        address: order.shipping_address?.address1 || '',
      },
      full_name: (order.shipping_address?.first_name || '') + ' ' + (order.shipping_address?.last_name || ''),
      phone: order.shipping_address?.phone || order.phone || '',
      order_reference: String(order.order_number),
      cash_on_delivery: parseFloat(order.total_price) || 0,
      allow_open_package: false
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
