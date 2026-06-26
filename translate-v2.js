#!/usr/bin/env node

/**
 * translate-v2.js
 *
 * Diffs en.json against the other locale files in the same directory,
 * finds keys that exist in en.json but are missing from a target locale,
 * translates the missing values via a self-hosted LibreTranslate instance,
 * and writes them back into the target locale file (without touching
 * existing translations or key order).
 *
 * Requires a running LibreTranslate instance — see docker-compose.yml in
 * this folder. Start it with:
 *   docker compose up -d
 * (first run downloads language models, can take a few minutes)
 *
 * Usage:
 *   node translate-v2.js
 *
 */

const fs = require("fs");
const path = require("path");

const PROJECTS = [
  {
    name: "project1",
    path: "./project1/src/i18n/locales",
    locales: ["nl", "fr", "de"],
  },
  {
    name: "project2",
    path: "./project2/src/i18n/base",
    locales: ["nl", "fr"],
  },
];

const SOURCE_LOCALE = "en";

// Values that should never be translated (brand/product names, etc).
// Self-hosted LibreTranslate has no concept of your domain — unlike Claude,
// it can't infer "Sparki" is a brand name, so this list is the ONLY
// protection here. Keep it accurate and complete.
const DO_NOT_TRANSLATE = new Set(["Ward", "Wakeboarding"]);

const LIBRETRANSLATE_URL = "http://localhost:5000";

// Guard so that {{ name }} in strings does not get translated
const PLACEHOLDER_REGEX = /(\{\{\s*[^}]+\s*\}\})|(<\/?\d+>)|(%[sdifo])/g;

// Turns a nested object {errors: {invalid: {title: ... }}}
// into a dot path (errors.invalid.title)
function flatten(obj, prefix = "") {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flatten(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

// Turns a dot path (errors.invalid.title)
// into a nested object {errors: {invalid: {title: ... }}}
function unflatten(obj, dotPath, value) {
  const parts = dotPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      typeof current[part] !== "object" ||
      current[part] === null ||
      Array.isArray(current[part])
    ) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + "\n", "utf-8");
}

function protectPlaceholders(text) {
  const placeholders = [];

  const protectedText = text.replace(PLACEHOLDER_REGEX, (match) => {
    const token = `ZXQPLACEHOLDER${placeholders.length}ZXQ`;

    placeholders.push(match);

    return token;
  });

  return {
    protectedText,
    placeholders,
  };
}

function restorePlaceholders(text, placeholders) {
  return placeholders.reduce(
    (result, placeholder, index) =>
      result.replace(`ZXQPLACEHOLDER${index}ZXQ`, placeholder),
    text,
  );
}

async function checkInstanceIsUp() {
  try {
    const res = await fetch(`${LIBRETRANSLATE_URL}/languages`);
    if (!res.ok) return false;
    return true;
  } catch {
    return false;
  }
}

async function translateBatch(texts, targetLang) {
  const protectedEntries = texts.map((text) => protectPlaceholders(text));

  const res = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: protectedEntries.map((entry) => entry.protectedText),
      source: SOURCE_LOCALE,
      target: targetLang,
      format: "text",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();

    throw new Error(`LibreTranslate error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  const translatedTexts = Array.isArray(data.translatedText)
    ? data.translatedText
    : [data.translatedText];

  return translatedTexts.map((translation, index) =>
    restorePlaceholders(translation, protectedEntries[index].placeholders),
  );
}

async function main() {
  console.log(`Checking LibreTranslate instance at ${LIBRETRANSLATE_URL}...`);
  const isUp = await checkInstanceIsUp();

  if (!isUp) {
    console.error(`Could not reach LibreTranslate at ${LIBRETRANSLATE_URL}.`);
    console.error("Start it with: docker compose up -d");
    process.exit(1);
  }
  console.log("LibreTranslate is up.\n");

  let totalAdded = 0;

  for (const project of PROJECTS) {
    const localesDir = path.resolve(__dirname, project.path);
    const sourcePath = path.join(localesDir, `${SOURCE_LOCALE}.json`);

    if (!fs.existsSync(sourcePath)) {
      console.log(`[${project.name}] skipped (no en.json found)`);
      continue;
    }

    console.log(`\n=== ${project.name.toUpperCase()} ===`);

    const sourceJson = readJson(sourcePath);
    const flatSource = flatten(sourceJson);

    for (const localeCode of project.locales) {
      const targetPath = path.join(localesDir, `${localeCode}.json`);
      const targetJson = readJson(targetPath);
      const flatTarget = flatten(targetJson);
      const missingKeys = Object.keys(flatSource).filter(
        (key) => !(key in flatTarget),
      );

      if (missingKeys.length === 0) {
        console.log(`[${localeCode}] up to date.`);
        continue;
      }

      console.log(`[${localeCode}] ${missingKeys.length} missing key(s)`);

      const toTranslate = [];
      const keysToKeepAsIs = [];

      for (const key of missingKeys) {
        const value = flatSource[key];

        if (typeof value !== "string") {
          keysToKeepAsIs.push(key);
        } else if (DO_NOT_TRANSLATE.has(value.trim())) {
          keysToKeepAsIs.push(key);
        } else {
          toTranslate.push(key);
        }
      }

      for (const key of keysToKeepAsIs) {
        unflatten(targetJson, key, flatSource[key]);
      }

      if (toTranslate.length > 0) {
        const translatedValues = await translateBatch(
          toTranslate.map((key) => flatSource[key]),
          localeCode,
        );

        toTranslate.forEach((key, index) => {
          unflatten(targetJson, key, translatedValues[index]);
        });
      }

      writeJson(targetPath, targetJson);

      totalAdded += missingKeys.length;

      console.log(`[${localeCode}] wrote ${missingKeys.length} key(s)`);
    }
  }

  console.log(`\nDone. Added ${totalAdded} key(s) total.`);
}

main().catch((err) => {
  console.error("translate-v2.js failed:", err);
  process.exit(1);
});
