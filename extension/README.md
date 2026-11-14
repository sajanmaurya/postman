# E-postman Chrome Extension

A Chrome Manifest V3 side-panel companion for WhatsApp Web. It stores contacts in Chrome local storage, imports CSV files, supports Select all, personalizes message templates with `{name}` and `{phone}`, and opens each selected WhatsApp chat with its message prefilled.

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's `extension` folder.
6. Open WhatsApp Web and click the E-postman extension icon to open the side panel.

## CSV format

Use a header row with `name,phone`. Include the country code in each phone number, digits only or with punctuation.

## Sending model and limitations

E-postman opens one WhatsApp Web chat at a time with a personalized draft. The user must review the recipient and press **Send** in WhatsApp Web. It does not automate clicks or send messages in the background. This is intentional: WhatsApp Web's internal interface is not a stable public extension API, and automated bulk sending can violate WhatsApp's terms or lead to account restrictions.

Contacts are stored locally in the browser using `chrome.storage.local`. They are separate from the local dashboard's JSON store.
