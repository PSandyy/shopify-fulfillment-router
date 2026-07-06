  const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
const LIMIT = 30;

let counter = 0;
let lastReset = new Date().toDateString();

app.post('/webhook/order', async (req, res) => {
  res.sendStatus(200);

  // Reset counter every day
  const today = new Date().toDateString();
  if (today !== lastReset) {
    counter = 0;
    lastReset = today;
  }

  counter++;
  const order = req.body;
  const orderId = order.id;
  const tag = counter <= LIMIT ? 'bosta' : 'shipblu';

  console.log(`Order #${order.order_number} → ${tag} (counter: ${counter})`);

  await fetch(`https://${SHOPIFY_STORE}/admin/api/2024-01/orders/${orderId}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_TOKEN
    },
    body: JSON.stringify({
      order: {
        id: orderId,
        tags: order.tags ? `${order.tags},${tag}` : tag
      }
    })
  });
});

app.get('/', (req, res) => res.send('Fulfillment Router Running ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
