/**
 * Script de précalcul quotidien des indices pollen Atmo Data.
 *
 * ⚠️ CE SCRIPT EST UN SQUELETTE À AJUSTER :
 * les noms de champs dans la réponse de l'API (section "TODO" ci-dessous)
 * sont des hypothèses raisonnables, pas une certitude — ils doivent être
 * vérifiés sur un premier appel réussi avant la mise en production.
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
  // TODO: confirmer le nom exact du champ contenant le token dans la
  // réponse réelle (souvent "token", parfois "access_token" ou "jwt").
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
 * Parse le CSV renvoyé par l'API en tableau d'objets.
 * TODO: ajuster le séparateur (`,` vs `;`) et les noms de colonnes une fois
 * un exemple réel de réponse disponible.
 */
function parseCsv(csvText) {
  const [headerLine, ...lines] = csvText.trim().split('\n');
  const headers = headerLine.split(',').map((h) => h.trim());

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(',');
      const row = {};
      headers.forEach((header, i) => {
        row[header] = values[i] ? values[i].trim() : null;
      });
      return row;
    });
}

/**
 * Regroupe les lignes par département et écrit un fichier JSON par shard.
 * TODO: remplacer "code_zone" par le nom réel du champ code INSEE dans la
 * réponse si différent.
 */
function writeShards(rows) {
  const shards = {};

  for (const row of rows) {
    const inseeCode = row.code_zone; // TODO: vérifier ce nom de champ
    if (!inseeCode) continue;

    const shardKey = getDepartmentShardFromInsee(inseeCode);
    if (!shards[shardKey]) shards[shardKey] = [];
    shards[shardKey].push(row);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const [shardKey, shardRows] of Object.entries(shards)) {
    const filePath = path.join(OUTPUT_DIR, `${shardKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify(shardRows, null, 2), 'utf-8');
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

  writeShards(rows);
}

main().catch((err) => {
  console.error('Erreur lors du précalcul :', err);
  process.exit(1);
});
