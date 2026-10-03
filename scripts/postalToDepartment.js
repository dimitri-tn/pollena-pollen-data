/**
 * Déduit la "clé de shard" (fichier JSON) à partir d'un code postal français.
 *
 * Règles :
 * - DOM (971-976) : les 3 premiers chiffres suffisent, ils correspondent
 *   directement au code département INSEE (971 Guadeloupe, 972 Martinique,
 *   973 Guyane, 974 Réunion, 976 Mayotte).
 * - Corse (20xxx) : les codes postaux ne permettent PAS de distinguer
 *   fiablement 2A (Corse-du-Sud) de 2B (Haute-Corse) — la limite ne suit
 *   pas une simple tranche numérique. Choix pragmatique : on fusionne 2A et
 *   2B dans un seul fichier shard "20" (le fichier sera juste un peu plus
 *   gros, sans incidence pratique vu le faible nombre de communes corses).
 * - Métropole : les 2 premiers chiffres du code postal correspondent au
 *   département dans l'immense majorité des cas (quelques exceptions
 *   existent pour des communes en bordure de département, mais sans
 *   impact ici : au pire l'utilisateur reçoit les données du département
 *   postal plutôt que du département INSEE réel, ce qui reste cohérent
 *   géographiquement pour un indice pollen régional).
 *
 * @param {string} postalCode - code postal à 5 chiffres (ex: "34070")
 * @returns {string} clé de shard (ex: "34", "20", "974")
 */
function getDepartmentShard(postalCode) {
  const cp = String(postalCode).trim();

  if (!/^\d{5}$/.test(cp)) {
    throw new Error(`Code postal invalide : "${postalCode}"`);
  }

  if (/^97[1-6]/.test(cp)) {
    return cp.slice(0, 3); // DOM
  }

  if (cp.startsWith('20')) {
    return '20'; // Corse fusionnée (2A + 2B)
  }

  return cp.slice(0, 2); // Métropole
}

/**
 * Déduit la clé de shard directement à partir d'un code INSEE commune
 * (utile côté script de précalcul, où on manipule des codes INSEE et non
 * des codes postaux).
 *
 * @param {string} inseeCode - code INSEE commune (ex: "34047", "2A004", "97105")
 * @returns {string} clé de shard
 */
function getDepartmentShardFromInsee(inseeCode) {
  const code = String(inseeCode).trim().toUpperCase();

  if (code.startsWith('2A') || code.startsWith('2B')) {
    return '20'; // Corse fusionnée
  }

  if (/^97[1-6]/.test(code)) {
    return code.slice(0, 3); // DOM
  }

  return code.slice(0, 2); // Métropole
}

module.exports = { getDepartmentShard, getDepartmentShardFromInsee };

