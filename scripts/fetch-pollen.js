/**
 * Script de précalcul quotidien des indices pollen Atmo Data.
 *
 * Format de réponse confirmé le 3 octobre 2026 sur un appel réel à
 * GET /api/v2/data/indices/pollens (format=csv) : une ligne par commune
 * (~34 800 lignes), colonnes aasqa, date_maj, alerte, code_ambr, code_arm,
 * code_aul, code_boul, code_gram, code_oliv, code_zone, conc_*, date_dif,
 * date_ech, lib_qual, lib_zone, type_zone, pollen_resp, source, code_qual.
 * Le champ "token" de la réponse de connexion est également confirmé.
 *
 * Nécessite Node.js 18+ (fetch natif) et les secrets d'environnement
 * ATMO_LOGIN / ATMO_PASSWORD (configurés comme secrets GitHub Actions).
 */

const fs = require('fs');
const path = require('path');
const { getDepartmentShardFromInsee } = require('./postalToDepartment');

const BASE_URL = 'https://admindata.atmo-france.org';
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'communes');

async function login() {
  const { ATMO_LOGIN, ATMO_PASSWORD } = process.env;
  if (!ATMO_LOGIN || !ATMO_PASSWORD) {
    throw new Error('ATMO_LOGIN et ATMO_PASSWORD doivent être définis.');
  }

  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Le Swagger affiche "username"/"password" dans le schéma de login
    body: JSON.stringify({ username: ATMO_LOGIN, password: ATMO_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Échec du login : ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // Confirmé le 3 octobre 2026 : le champ s'appelle bien "token". Les deux
  // autres noms sont gardés en repli par simple prudence, sans incidence.
  const token = data.token || data.access_token || data.jwt;
  if (!token) {
    throw new Error('Token introuvable dans la réponse de /api/login.');
  }
  return token;
}

async function fetchPollenData(token) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const url = new URL(`${BASE_URL}/api/v2/data/indices/pollens`);
  url.searchParams.set('format', 'csv'); // plus compact à parser que geojson
  url.searchParams.set('date', today);
  url.searchParams.set('with_geom', 'false');
  // Pas de code_zone => toutes les zones disponibles par défaut

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Échec de la récupération : ${res.status} ${await res.text()}`);
  }

  return res.text(); // CSV brut
}

/**
 * Découpe une ligne CSV en tenant compte des champs entre guillemets
 * (un champ "a, b" ne doit pas être coupé sur sa virgule interne), et des
 * guillemets échappés ("" à l'intérieur d'un champ guillemeté = un seul ").
 */
function splitCsvLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } // guillemet échappé
        else inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((v) => v.trim());
}

/**
 * Parse le CSV renvoyé par l'API en tableau d'objets.
 * - Détecte automatiquement le séparateur (`,` ou `;`, fréquent côté
 *   exports français) en comptant lequel est le plus présent sur l'en-tête.
 * - Retire un éventuel BOM UTF-8 en tête de fichier (fréquent sur les
 *   exports de données publiques françaises), qui sinon corromprait le
 *   nom de la première colonne.
 * - Gère les champs entre guillemets (voir splitCsvLine ci-dessus).
 * TODO: vérifier les noms de colonnes une fois un exemple réel disponible.
 */
function parseCsv(csvText) {
  const cleaned = csvText.replace(/^\uFEFF/, ''); // retire le BOM UTF-8 s'il est présent
  const [headerLine, ...lines] = cleaned.trim().split('\n');

  const delimiter = (headerLine.match(/;/g) || []).length >= (headerLine.match(/,/g) || []).length ? ';' : ',';
  const headers = splitCsvLine(headerLine, delimiter);

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = splitCsvLine(line, delimiter);
      const row = {};
      headers.forEach((header, i) => {
        row[header] = values[i] !== undefined && values[i] !== '' ? values[i] : null;
      });
      return row;
    });
}

/**
 * Regroupe les lignes par département et écrit un fichier JSON par shard.
 * Format confirmé le 3 octobre 2026 sur un appel réel : une ligne par
 * commune (type_zone="commune"), avec "code_zone" = code INSEE commune.
 * Chaque ligne contient directement une colonne par pollen
 * (code_ambr, code_arm, code_aul, code_boul, code_gram, code_oliv)
 * plutôt qu'une ligne par pollen — voir IndicePollenTab côté app.
 */
function writeShards(rows) {
  const shards = {};

  for (const row of rows) {
    const inseeCode = row.code_zone;
    if (!inseeCode) continue;

    const shardKey = getDepartmentShardFromInsee(inseeCode);
    if (!shards[shardKey]) shards[shardKey] = [];
    shards[shardKey].push(row);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [shardKey, shardRows] of Object.entries(shards)) {
    const filePath = path.join(OUTPUT_DIR, `${shardKey}.json`);
    // JSON compact (sans indentation) : fichiers plus légers à télécharger pour
    // les utilisateurs de l'app, qui n'ont de toute façon pas besoin de lire
    // ce fichier à l'œil. Pour déboguer à la main, repasser temporairement à
    // JSON.stringify(shardRows, null, 2).
    fs.writeFileSync(filePath, JSON.stringify(shardRows), 'utf-8');
  }

  console.log(`${Object.keys(shards).length} fichiers département écrits dans ${OUTPUT_DIR}`);
}

async function main() {
  console.log('Connexion à Atmo Data...');
  const token = await login();

  console.log('Récupération des indices pollen...');
  const csvText = await fetchPollenData(token);

  console.log('Parsing et découpage par département...');
  const rows = parseCsv(csvText);
  console.log(`${rows.length} lignes reçues au total.`);

  if (rows.length === 0) {
    // Une réponse vide est presque toujours le signe d'un problème (mauvais
    // nom de paramètre, date sans donnée publiée, format inattendu) plutôt
    // que d'une situation normale — on fait échouer le job pour qu'il soit
    // visible dans l'onglet Actions, plutôt que d'écraser silencieusement
    // les fichiers existants avec des fichiers vides.
    throw new Error("Aucune ligne reçue de l'API : vérifier les paramètres de la requête et la réponse brute.");
  }

  writeShards(rows);
}

main().catch((err) => {
  console.error('Erreur lors du précalcul :', err);
  process.exit(1);
});
