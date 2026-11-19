import http from 'node:http';
import pkg from '@croo-network/sdk';
import { run, norm as ascii } from './extractor.js';

const { AgentClient, EventType, DeliverableType } = pkg;

const PORT = process.env.PORT || 3000;
const KEY = (process.env.CROO_API_KEY || '').trim();
let wsStatus = 'not started';

// ---------- web ----------
const TRY_PAGE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DataDistill</title>
<body style="font-family:sans-serif;max-width:720px;margin:auto;padding:16px">
<h2>DataDistill</h2>
<p>Paste messy text (notes, emails, invoices, chat). Add "Format: json", "Format: csv" or "Format: both".</p>
<textarea id="t" rows="10" style="width:100%">Hi team, Sarah Johnson from Acme Labs (sarah.j@acme.com, +234 803 123 4567) wants invoice INV-2041 for $1,250.50 paid by Nov 25. Dave will email the contract by Friday - urgent! Call Mr. Okafor on 15/12/2026 at 3pm. Discount of 15% for 20 users. Format: csv</textarea>
<p><button id="b" style="padding:10px 18px">Extract</button></p>
<pre id="o" style="white-space:pre-wrap"></pre>
<script>
b.onclick=async()=>{o.textContent='...';const r=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:t.value})});const j=await r.json();o.textContent=j.result||j.error;};
</script>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('DataDistill online\n' + (KEY ? 'provider key configured' : 'provider key MISSING') + '\nCROO WebSocket: ' + wsStatus);
  }
  if (req.method === 'GET' && req.url === '/try') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(TRY_PAGE);
  }
  if (req.method === 'POST' && req.url === '/api/extract') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body || '{}');
        const out = { result: run(text || '') };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});
server.listen(PORT, () => console.log('Web server on ' + PORT));

// keep-alive for Render free tier
if (process.env.RENDER_EXTERNAL_URL) {
  setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL).catch(() => {}), 14 * 60 * 1000);
}

// ---------- CROO provider ----------
const WRAP_KEYS = ['text', 'requirement', 'requirements', 'input', 'data', 'content', 'message'];

function unwrap(v) {
  for (let i = 0; i < 6; i++) {
    if (typeof v === 'string') {
      const s = v.trim();
      if (s.startsWith('{') && s.endsWith('}')) {
        try { v = JSON.parse(s); continue; } catch { return v; }
      }
      return v;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length === 1 && WRAP_KEYS.includes(keys[0])) { v = v[keys[0]]; continue; }
      return JSON.stringify(v);
    }
    return String(v ?? '');
  }
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function readRequirement(order) {
  for (const k of ['requirement', 'requirements', 'requirementText', 'input', 'data']) {
    const v = order && order[k];
    if (v !== undefined && v !== null && String(typeof v === 'string' ? v : JSON.stringify(v)).trim() !== '') return unwrap(v);
  }
  return '';
}

const handled = new Set();
let connecting = false;
let attempt = 0;

async function onPaid(provider, e) {
  const orderId = e.order_id;
  if (handled.has(orderId)) return;
  handled.add(orderId);
  let text;
  try {
    const order = await provider.getOrder(orderId);
    const input = readRequirement(order);
    text = run(input);
  } catch (err) {
    console.error('Analysis error:', err && err.message);
    text = 'DataDistill hit an internal error while processing this order. Please contact the provider with your order id: ' + orderId;
  }
  try {
    await provider.deliverOrder(orderId, {
      deliverableType: DeliverableType.Text,
      deliverableText: ascii(text),
    });
    console.log('Delivered order', orderId);
  } catch (err) {
    console.error('Delivery error:', err && err.message);
  }
}

async function connect() {
  if (!KEY) { console.error('CROO_API_KEY missing'); return; }
  if (connecting) return;
  connecting = true;
  try {
    const config = {
      baseURL: process.env.CROO_API_URL,
      wsURL: process.env.CROO_WS_URL,
      rpcURL: process.env.CROO_RPC_URL || 'https://mainnet.base.org',
      logger: { debug() {}, info: console.log, warn: console.warn, error: console.error },
    };
    const provider = new AgentClient(config, KEY);
    const stream = await provider.connectWebSocket();
    wsStatus = 'connected';
    attempt = 0;
    console.log('CROO WebSocket connected');

    stream.on(EventType.NegotiationCreated, async (e) => {
      try {
        await provider.acceptNegotiation(e.negotiation_id);
        console.log('Accepted negotiation', e.negotiation_id);
      } catch (err) { console.error('Accept error:', err && err.message); }
    });
    stream.on(EventType.OrderPaid, (e) => onPaid(provider, e));
    stream.on(EventType.OrderCompleted, (e) => console.log('Order completed', e.order_id));
    stream.on('close', () => {
      wsStatus = 'closed';
      connecting = false;
      scheduleReconnect();
    });
    stream.on('error', (err) => console.error('WS error:', err && err.message));
    connecting = false;
  } catch (err) {
    wsStatus = 'error';
    connecting = false;
    console.error('Connect error:', err && err.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  attempt++;
  const delay = Math.min(60000, 2000 * 2 ** Math.min(attempt, 5));
  console.log('Reconnecting in ' + delay / 1000 + 's');
  setTimeout(connect, delay);
}

connect();
