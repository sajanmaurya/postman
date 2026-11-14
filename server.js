import express from 'express';
import { Client, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AUTH_DIR = process.env.WWEBJS_AUTH_DIR || path.join(__dirname, '.wwebjs_auth');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (process.env.NODE_ENV === 'production' && (!ADMIN_USER || !ADMIN_PASSWORD)) {
  throw new Error('Set ADMIN_USER and ADMIN_PASSWORD before running in production.');
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const emptyStore = { contacts: [], campaigns: [], messages: [] };
function loadStore() {
  try { return { ...emptyStore, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; }
  catch { return structuredClone(emptyStore); }
}
let store = loadStore();
function saveStore() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const id = () => crypto.randomUUID();
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'e-postman', dataPath: AUTH_DIR }),
  puppeteer: {
    headless: true,
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});
let waState = 'initializing', qrDataUrl = null, waError = null;
let activeCampaign = null, pauseRequested = false, stopRequested = false;
client.on('qr', async qr => { qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 }); waState = 'qr'; });
client.on('authenticated', () => { waState = 'authenticated'; qrDataUrl = null; waError = null; });
client.on('ready', () => { waState = 'ready'; qrDataUrl = null; waError = null; });
client.on('auth_failure', msg => { waState = 'auth_failure'; waError = String(msg); });
client.on('disconnected', reason => { waState = 'disconnected'; waError = String(reason); });
client.on('message_ack', (msg, ack) => {
  const record = store.messages.find(m => m.waMessageId === msg.id?._serialized);
  if (record) { record.ack = ack; saveStore(); }
});
client.initialize().catch(err => { waState = 'error'; waError = err.message; });
// Public health check for the hosting platform.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Protect the dashboard and every API route with HTTP Basic Auth in production.
if (ADMIN_USER && ADMIN_PASSWORD) {
  const safeEqual = (a, b) => {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  };
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="E-postman"');
      return res.status(401).send('Authentication required');
    }
    let decoded = '';
    try { decoded = Buffer.from(header.slice(6), 'base64').toString('utf8'); } catch {}
    const separator = decoded.indexOf(':');
    const username = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    if (!safeEqual(username, ADMIN_USER) || !safeEqual(password, ADMIN_PASSWORD)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="E-postman"');
      return res.status(401).send('Invalid credentials');
    }
    next();
  });
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/status', (_req, res) => res.json({ state: waState, qr: qrDataUrl, error: waError, campaignRunning: Boolean(activeCampaign), activeCampaignId: activeCampaign }));
app.post('/api/logout', async (_req, res) => {
  try { await client.logout(); waState = 'disconnected'; qrDataUrl = null; res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/contacts', (_req, res) => res.json(store.contacts));
app.post('/api/contacts', (req, res) => {
  const { name, phone, optedIn } = req.body || {};
  const cleanPhone = String(phone || '').replace(/[^\d]/g, '');
  if (!name?.trim() || cleanPhone.length < 8 || cleanPhone.length > 15) return res.status(400).json({ error: 'Enter a name and a valid phone number with country code.' });
  if (store.contacts.some(c => c.phone === cleanPhone)) return res.status(409).json({ error: 'This phone number already exists.' });
  const contact = { id: id(), name: name.trim(), phone: cleanPhone, optedIn: optedIn === true, createdAt: new Date().toISOString() };
  store.contacts.push(contact); saveStore(); res.status(201).json(contact);
});
app.post('/api/contacts/import', (req, res) => {
  const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  if (rows.length > 2000) return res.status(400).json({ error: 'Import is limited to 2,000 rows at a time.' });
  let added = 0, skipped = 0;
  for (const row of rows) {
    const phone = String(row.phone || '').replace(/[^\d]/g, ''), name = String(row.name || '').trim();
    if (!name || phone.length < 8 || phone.length > 15 || store.contacts.some(c => c.phone === phone)) { skipped++; continue; }
    store.contacts.push({ id: id(), name, phone, optedIn: row.optedIn === true, createdAt: new Date().toISOString() }); added++;
  }
  saveStore(); res.json({ added, skipped });
});
app.delete('/api/contacts/:id', (req, res) => { store.contacts = store.contacts.filter(c => c.id !== req.params.id); saveStore(); res.json({ ok: true }); });
app.get('/api/campaigns', (_req, res) => res.json(store.campaigns.slice().reverse()));
app.get('/api/messages', (_req, res) => res.json(store.messages.slice(-300).reverse()));
async function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function runCampaign(campaign) {
  activeCampaign = campaign.id; pauseRequested = false; stopRequested = false;
  campaign.status = 'running'; campaign.startedAt = new Date().toISOString(); saveStore();
  const recipients = store.contacts.filter(c => campaign.contactIds.includes(c.id) && c.optedIn);
  campaign.total = recipients.length; campaign.sent = 0; campaign.failed = 0; saveStore();
  for (const contact of recipients) {
    while (pauseRequested && !stopRequested) { campaign.status = 'paused'; saveStore(); await wait(500); }
    if (stopRequested) break;
    if (waState !== 'ready') { campaign.status = 'interrupted'; campaign.error = 'WhatsApp disconnected. Reconnect and start a new campaign.'; break; }
    const body = campaign.text.replaceAll('{name}', contact.name).replaceAll('{phone}', contact.phone);
    const message = { id: id(), campaignId: campaign.id, contactId: contact.id, name: contact.name, phone: contact.phone, text: body, status: 'sending', createdAt: new Date().toISOString() };
    store.messages.push(message); saveStore();
    try {
      const sent = await client.sendMessage(`${contact.phone}@c.us`, body);
      message.status = 'sent'; message.waMessageId = sent.id?._serialized || null; message.sentAt = new Date().toISOString(); campaign.sent++;
    } catch (e) { message.status = 'failed'; message.error = String(e.message || e).slice(0, 300); campaign.failed++; }
    saveStore();
    if (!stopRequested) await wait(campaign.delayMs);
  }
  campaign.status = stopRequested ? 'stopped' : (campaign.status === 'interrupted' ? 'interrupted' : 'completed');
  campaign.finishedAt = new Date().toISOString(); saveStore();
  activeCampaign = null; pauseRequested = false; stopRequested = false;
}
app.post('/api/campaigns', (req, res) => {
  const { name, text, contactIds, delaySeconds } = req.body || {};
  if (waState !== 'ready') return res.status(409).json({ error: 'Connect WhatsApp before starting a campaign.' });
  if (activeCampaign) return res.status(409).json({ error: 'Another campaign is already running.' });
  if (!String(text || '').trim()) return res.status(400).json({ error: 'Message text is required.' });
  if (!Array.isArray(contactIds) || contactIds.length === 0) return res.status(400).json({ error: 'Select at least one contact.' });
  const chosen = store.contacts.filter(c => contactIds.includes(c.id) && c.optedIn);
  if (!chosen.length) return res.status(400).json({ error: 'No selected contacts have recorded opt-in consent.' });
  const campaign = { id: id(), name: String(name || 'Untitled campaign').trim().slice(0, 100), text: String(text).slice(0, 4000), contactIds: chosen.map(c => c.id), delayMs: Math.max(5000, Math.min(60000, Number(delaySeconds || 15) * 1000)), status: 'queued', total: chosen.length, sent: 0, failed: 0, createdAt: new Date().toISOString() };
  store.campaigns.push(campaign); saveStore();
  runCampaign(campaign).catch(err => { campaign.status = 'error'; campaign.error = err.message; saveStore(); activeCampaign = null; });
  res.status(202).json({ id: campaign.id, status: 'queued', total: campaign.total });
});
app.post('/api/campaigns/pause', (_req, res) => { if (!activeCampaign) return res.status(409).json({ error: 'No campaign is running.' }); pauseRequested = true; res.json({ ok: true }); });
app.post('/api/campaigns/resume', (_req, res) => { if (!activeCampaign) return res.status(409).json({ error: 'No campaign is running.' }); pauseRequested = false; res.json({ ok: true }); });
app.post('/api/campaigns/stop', (_req, res) => { if (!activeCampaign) return res.status(409).json({ error: 'No campaign is running.' }); stopRequested = true; pauseRequested = false; res.json({ ok: true }); });
app.get('/api/export', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="e-postman-backup.json"'); res.json(store); });
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, HOST, () => console.log(`E-postman running on ${HOST}:${PORT}`));
process.on('SIGINT', async () => { try { await client.destroy(); } finally { process.exit(0); } });
