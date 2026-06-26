# i18n - Translator

A small toolkit to manage JSON translation files. Designed to auto-translate, export, validate and import translations in multiple languages (EN -> FR, NL) with DeepL API.

## NEW - translate-v2.js

translate-v2 was added and a LibreTranslate docker compose file.
Just start a docker container with LibreTranslate with:

```bash
docker compose up -d
```

Then edit the paths in translate-v2.js to your locales files and

```bash

npm run translate-v2
```

## Quick Start

Create a `.env` file with your DeepL API key:

```bash
DEEPL_FREE_SECRET=your_api_key_here
```

---

### Node.js

Make sure you have Node.js and npm installed.

```bash
https://nodejs.org/en/download
```

Install dependencies

```bash
npm install
```

Add a word or sentence in the en.json you want to translate (I've added an example already).

Run the translation script:

```bash
npm run translate
```

To export translations to an Excel:

```bash
npm run export
```

To import translations from an Excel:

```bash
npn run import
```

---

### Python: Run the CLI

```bash
./start
```
