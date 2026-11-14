# E-postman — WhatsApp Campaign Sender

A local-first WhatsApp campaign dashboard built with Node.js, Express, and whatsapp-web.js. Connect by scanning the WhatsApp Web QR code, manage contacts, import CSV files, and send sequential text campaigns to contacts with recorded opt-in consent.

## Requirements
- Node.js 20+
- WhatsApp account

## Run locally
```bash
npm install
npm start
```
Open http://127.0.0.1:3000 and scan the QR code using WhatsApp → Linked devices → Link a device.

## CSV format
```csv
name,phone,optedin
Alex,919876543210,true
Sam,14155550123,false
```
Use international phone digits with country code. Only contacts with `optedin=true` can be selected for campaigns.

## Important
This uses `whatsapp-web.js`, an unofficial integration. WhatsApp can change compatibility or restrict accounts. Delays do not guarantee safety. Use only for legitimate, consent-based messaging and respect opt-outs. The app binds to localhost and is not a hosted SaaS. Keep your computer awake while a campaign runs.
