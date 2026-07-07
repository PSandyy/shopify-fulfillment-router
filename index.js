const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const BOSTA_API_KEY = process.env.BOSTA_API_KEY;
const SHIPBLU_API_KEY = process.env.SHIPBLU_API_KEY;
const LIMIT = 30;

let counter = 0;
let lastReset = new Date().toDateString();

async function sendToBosta(order) {
  const res = await fetch('https://app.bosta.co/api/v2/deliveries', {
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
  });
  const data = await res.json();
  console.log('Bosta response:', JSON.stringify(data));
  return data;
}

async function sendToShipBlu(order) {
  const res = await fetch('https://api.shipblu.com/api/v1/merchant/shipments/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SHIPBLU_API_KEY}`
    },
    body: JSON.stringify({
      address: {
        city: order.shipping_address?.city || 'Cairo',
        address: order.shipping_address?.address1 || '',
      },
      full_name: `${order.shipping_address?.first_name || ''} ${order.shipping_address?.last_name || ''}`,
      phone: order.shipping_address?.phone || order.phone || '',
      order_reference: String(order.order_number),
      cash_on_delivery: parseFloat(order.total_price) || 0,
      allow_open_package: false
    })
  });
  const data = await res.json();
  console.log('ShipBlu response:', JSON.stringify(data));
  return data;
}

app.post('/webhook/order', async (req, res) => {
  res.sendStatus(200);

  const today = new Date().toDateString();
  if (today !== lastReset) {
    counter = 0;
    lastReset = today;
  }

  counter++;
  const order = req.body;
  console.log(`Order #${order.order_number} → ${counter <= LIMIT ? 'bosta' : 'shipblu'} (counter: ${counter})`);

  if (counter <= LIMIT) {
    await sendToBosta(order);
  } else {
    await sendToShipBlu(order);
  }
});

app.get('/', (req, res) => res.send('Fulfillment Router Running ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
