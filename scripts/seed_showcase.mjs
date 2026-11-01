/**
 * Build a SYNTHETIC two-quarter database, to preview and screenshot the
 * dashboards at the size of the real market.
 *
 * DEVELOPMENT ONLY. Every company in it is invented -- name, ticker, website,
 * filings and every figure -- from a fixed seed, so the same command builds
 * the same companies, and no Deloitte client information (nor any real
 * issuer) can reach a screenshot taken from it. Firms and places are real
 * vocabulary; the companies are not.
 *
 * The one fixture the repository had, tests/fixtures/synthetic_whitespace.xlsx,
 * holds eight companies: enough to drive every code path, far too few to show
 * what a page looks like with 345 companies on it. This builds two quarters at
 * that size, through the application's own paths rather than by writing the
 * frozen tables, so the snapshot is shaped exactly as production's and every
 * tier comes from the classifier:
 *
 *   applySchema
 *   commitPeriod     Q3-2026 (2026-05-31), at the C$200M default
 *   recordDecision   the researched values, as overrides
 *   publishPeriod    Q3, revision 1
 *   putSettings      the line lowered to C$100M, as an Admin would
 *   commitPeriod     Q4-2026 (2026-08-31)
 *   recordDecision   the same research a quarter on
 *   publishPeriod    Q4, which freezes prior_tier against Q3's revision
 *
 * Every override's reason says it is synthetic, and cites an address on
 * example.invalid, a reserved name that never resolves.
 *
 *   node scripts/seed_showcase.mjs ./showcase.db
 *   MM_DATABASE=./showcase.db MM_AUTH=dev MM_DEV_AUTH_SECRET=local \
 *     MM_ALLOWED_DOMAINS=example.invalid npx next dev
 *
 * then sign in (POST /api/dev/signin) as viewer@, analyst@ or
 * admin@example.invalid. The file is rebuilt from nothing on every run, and a
 * file this script did not build is never deleted: ./period.db is a real
 * quarter.
 */
import { existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { applySchema } from "../src/lib/db/schema.ts";
import { commitPeriod, normName } from "../src/lib/db/commit.ts";
import { SqliteSql } from "../src/lib/db/sqlite.ts";
import { nameStem } from "../src/lib/identity/merge.ts";
import { deloitteMarketFor } from "../src/lib/ingest/tsx.ts";
import { evaluateGate } from "../src/lib/publish/gate.ts";
import { publishPeriod, PublishBlocked } from "../src/lib/publish/snapshot.ts";
import { tierMigration } from "../src/lib/publish/views.ts";
import { recordDecision } from "../src/lib/review/decide.ts";
import { putSettings } from "../src/lib/settings/index.ts";

const dbPath = process.argv[2];
if (!dbPath || dbPath.startsWith("-")) {
  console.error("usage: node scripts/seed_showcase.mjs <path/to/showcase.db>");
  process.exit(2);
}

const SEED = 20260831;
/** The audit_log event that marks a database as one this script built. */
const MARK = "showcase_seeded";
/** Only used if a gate refuses; it would print on the dashboard header. */
const OVERRIDE_REASON = "Synthetic showcase data for local preview.";

const M = 1e6;
const B = 1e9;
const Q3 = { key: "q3", label: "Q3-2026 (2026-05-31)", asOf: "2026-05-31", threshold: 200 * M };
const Q4 = { key: "q4", label: "Q4-2026 (2026-08-31)", asOf: "2026-08-31", threshold: 100 * M };

const USERS = [
  ["analyst@example.invalid", "analyst"],
  ["viewer@example.invalid", "viewer"],
  ["admin@example.invalid", "admin"],
];

/* ---------------------------------------------------------------- dice */

// mulberry32: tiny, and the same on every machine. Every draw below comes
// from this one stream in a fixed order, so reordering the draws changes the
// companies -- which is fine, as long as nothing else does.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const chance = (p) => rand() < p;
const between = (lo, hi) => lo + (hi - lo) * rand();
const intBetween = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];

function gauss() {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** One value from [value, weight] pairs. */
function weighted(pairs) {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) { r -= w; if (r < 0) return v; }
  return pairs[pairs.length - 1][0];
}

/** k distinct items, each drawn with probability proportional to weightOf(item). */
function sample(items, k, weightOf = () => 1) {
  const pool = items.map((x) => [x, weightOf(x)]).filter(([, w]) => w > 0);
  const out = [];
  while (out.length < k && pool.length > 0) {
    let r = rand() * pool.reduce((a, [, w]) => a + w, 0);
    let i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i][1]; if (r < 0) break; }
    out.push(pool[i][0]);
    pool.splice(i, 1);
  }
  return out;
}

/**
 * n uniform draws, one from each of n equal slices of [0, 1), shuffled. A
 * market cap read through these lands each size band within a company or two
 * of its expected count, where plain dice can put several points on a band.
 */
function strata(n) {
  const u = Array.from({ length: n }, (_, i) => (i + rand()) / n);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [u[i], u[j]] = [u[j], u[i]];
  }
  return u;
}

/**
 * Hand values out to items in exact proportions: counts by largest remainder,
 * then each value's items drawn by affinity, the last value taking the rest.
 * The headline shares a chart prints (footprint, auditor, commodity) come out
 * as designed instead of wherever one roll of the dice left them.
 */
function allot(items, pairs, affinity = () => 1) {
  const total = pairs.reduce((a, [, w]) => a + w, 0);
  const exact = pairs.map(([, w]) => (w / total) * items.length);
  const counts = exact.map(Math.floor);
  let short = items.length - counts.reduce((a, n) => a + n, 0);
  for (const i of exact.map((x, i) => i).sort((a, b) => (exact[b] % 1) - (exact[a] % 1))) {
    if (short-- <= 0) break;
    counts[i]++;
  }
  const out = new Map();
  let pool = items;
  pairs.forEach(([value], i) => {
    const chosen = i === pairs.length - 1 ? pool : sample(pool, counts[i], (item) => affinity(item, value));
    for (const item of chosen) out.set(item, value);
    const taken = new Set(chosen);
    pool = pool.filter((item) => !taken.has(item));
  });
  return out;
}

function dateIn([from, to]) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - a) / 86_400_000);
  return new Date(a + intBetween(0, days) * 86_400_000).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------- vocabulary */

const REGION_KEYS = ["CANADA", "USA", "LATIN AMERICA", "UK/EUROPE", "AFRICA", "ASIA", "AUS/NZ/PNG", "OTHER"];

const PROVINCES = [
  ["BC", 27], ["ON", 25], ["QC", 17], ["YT", 12], ["SK", 8], ["NL", 6], ["NT", 6],
  ["NU", 3.5], ["MB", 3], ["AB", 2], ["NB", 1.5], ["NS", 1.5],
];

// Spelled as mmparser/aliases.py normalises them (Côte d'Ivoire, Türkiye,
// Democratic Republic of the Congo), so a filter or a map key reads them as
// the workbook's own values. The twelve heads of the distribution first.
const FOREIGN = [
  ["LATIN AMERICA", "Mexico", 36], ["USA", "NV", 27], ["LATIN AMERICA", "Peru", 22],
  ["LATIN AMERICA", "Brazil", 20], ["LATIN AMERICA", "Argentina", 19], ["LATIN AMERICA", "Chile", 18],
  ["USA", "AK", 15], ["USA", "AZ", 12], ["AUS/NZ/PNG", "Australia", 11], ["LATIN AMERICA", "Colombia", 9],
  ["USA", "ID", 8.5], ["USA", "UT", 6],
  ["LATIN AMERICA", "Guyana", 5.5], ["AFRICA", "Côte d'Ivoire", 5.5], ["USA", "CA", 5],
  ["UK/EUROPE", "Türkiye", 5], ["AFRICA", "Mali", 4.5], ["AFRICA", "Burkina Faso", 4.5],
  ["UK/EUROPE", "Finland", 4.5], ["ASIA", "Mongolia", 4], ["AFRICA", "Ghana", 4], ["UK/EUROPE", "Sweden", 4],
  ["LATIN AMERICA", "Ecuador", 4], ["LATIN AMERICA", "Bolivia", 3.5], ["AFRICA", "Zambia", 3.5],
  ["AFRICA", "Tanzania", 3], ["AFRICA", "Namibia", 3], ["AFRICA", "Democratic Republic of the Congo", 3],
  ["USA", "WY", 3], ["USA", "MT", 3], ["LATIN AMERICA", "Nicaragua", 3], ["UK/EUROPE", "Spain", 3],
  ["UK/EUROPE", "Ireland", 3], ["ASIA", "Philippines", 3], ["AFRICA", "Senegal", 2.5], ["AFRICA", "Guinea", 2.5],
  ["AFRICA", "South Africa", 2.5], ["AFRICA", "Mauritania", 2], ["UK/EUROPE", "Portugal", 2],
  ["UK/EUROPE", "Norway", 2], ["AUS/NZ/PNG", "Papua New Guinea", 2], ["UK/EUROPE", "Greenland", 2],
  ["USA", "SD", 2], ["USA", "CO", 2], ["USA", "NM", 2], ["LATIN AMERICA", "Panama", 2],
  ["LATIN AMERICA", "Dominican Republic", 2], ["LATIN AMERICA", "Suriname", 2], ["ASIA", "Indonesia", 2],
  ["ASIA", "China", 2], ["ASIA", "Kazakhstan", 1.5], ["UK/EUROPE", "Serbia", 1.5], ["AFRICA", "Morocco", 1.5],
  ["AFRICA", "Botswana", 1.5], ["AFRICA", "Ethiopia", 1.5], ["AUS/NZ/PNG", "New Zealand", 1.5], ["USA", "OR", 1.5],
  ["AFRICA", "Zimbabwe", 1.2], ["UK/EUROPE", "United Kingdom", 1.2], ["UK/EUROPE", "Bulgaria", 1],
  ["UK/EUROPE", "Greece", 1], ["UK/EUROPE", "Poland", 1], ["UK/EUROPE", "Germany", 1], ["ASIA", "Kyrgyzstan", 1],
  ["ASIA", "South Korea", 1], ["ASIA", "Malaysia", 1], ["AFRICA", "Niger", 1], ["AFRICA", "Nigeria", 1],
  ["AFRICA", "Kenya", 1], ["AFRICA", "Egypt", 1], ["LATIN AMERICA", "Guatemala", 1], ["LATIN AMERICA", "Honduras", 1],
  ["USA", "MN", 1], ["USA", "MI", 1], ["USA", "WA", 1], ["USA", "TX", 0.8],
  ["USA", "SC", 0.8], ["OTHER", "Saudi Arabia", 0.8], ["UK/EUROPE", "Austria", 0.7], ["UK/EUROPE", "Romania", 0.7],
  ["UK/EUROPE", "Bosnia and Herzegovina", 0.7], ["AFRICA", "Sudan", 0.7], ["AFRICA", "Gabon", 0.7],
  ["AFRICA", "Malawi", 0.7], ["AFRICA", "Madagascar", 0.7], ["AFRICA", "Liberia", 0.7], ["AFRICA", "Sierra Leone", 0.7],
  ["AFRICA", "Mozambique", 0.7], ["ASIA", "Vietnam", 0.7], ["ASIA", "Uzbekistan", 0.7], ["USA", "NY", 0.6],
  ["USA", "VA", 0.6], ["UK/EUROPE", "North Macedonia", 0.5], ["UK/EUROPE", "Slovakia", 0.5], ["UK/EUROPE", "France", 0.5],
  ["UK/EUROPE", "Italy", 0.5], ["AFRICA", "Guinea-Bissau", 0.5], ["AFRICA", "Uganda", 0.5], ["AFRICA", "Cameroon", 0.5],
  ["AFRICA", "Eritrea", 0.5], ["AFRICA", "Angola", 0.5], ["ASIA", "Laos", 0.5], ["ASIA", "Japan", 0.5],
  ["ASIA", "Pakistan", 0.5], ["ASIA", "India", 0.5], ["LATIN AMERICA", "Uruguay", 0.5], ["LATIN AMERICA", "Paraguay", 0.5],
  ["USA", "WV", 0.5], ["USA", "AR", 0.5], ["USA", "NC", 0.5], ["USA", "ME", 0.5], ["UK/EUROPE", "Armenia", 0.4],
  ["UK/EUROPE", "Czech Republic", 0.4], ["LATIN AMERICA", "Venezuela", 0.4], ["OTHER", "Oman", 0.4],
  ["AUS/NZ/PNG", "Fiji", 0.4], ["AUS/NZ/PNG", "Solomon Islands", 0.3],
];

// [city, head_office_region, weight]. Canadian offices only in provinces the
// Deloitte market can be read from (deloitteMarketFor), as in the real book.
const HEAD_OFFICES = [
  ["Vancouver", "British Columbia, Canada", 44], ["North Vancouver", "British Columbia, Canada", 1.5],
  ["Kelowna", "British Columbia, Canada", 1.5], ["Victoria", "British Columbia, Canada", 1],
  ["Toronto", "Ontario, Canada", 22], ["Sudbury", "Ontario, Canada", 0.7], ["Thunder Bay", "Ontario, Canada", 0.6],
  ["Oakville", "Ontario, Canada", 0.4], ["Ottawa", "Ontario, Canada", 0.4],
  ["Montreal", "Quebec, Canada", 2.6], ["Val-d'Or", "Quebec, Canada", 0.5], ["Rouyn-Noranda", "Quebec, Canada", 0.3],
  ["Quebec City", "Quebec, Canada", 0.3],
  ["Calgary", "Alberta, Canada", 1.3], ["Edmonton", "Alberta, Canada", 0.3],
  ["Saskatoon", "Saskatchewan, Canada", 0.8], ["Halifax", "Nova Scotia, Canada", 1],
  ["St. John's", "Newfoundland and Labrador, Canada", 0.7],
  ["Perth", "Australia", 2.2], ["Brisbane", "Australia", 0.6], ["Sydney", "Australia", 0.5], ["Melbourne", "Australia", 0.3],
  ["Denver", "Colorado, United States", 1], ["Lakewood", "Colorado, United States", 0.4],
  ["Golden", "Colorado, United States", 0.3], ["London", "United Kingdom", 1.4],
  ["Coeur d'Alene", "Idaho, United States", 0.5], ["Boise", "Idaho, United States", 0.3],
  ["Phoenix", "Arizona, United States", 0.4], ["Tucson", "Arizona, United States", 0.4],
  ["Reno", "Nevada, United States", 0.6], ["Spokane", "Washington, United States", 0.3],
  ["Salt Lake City", "Utah, United States", 0.2],
  ["Santiago", "Chile", 0.5], ["Lima", "Peru", 0.4], ["Mexico City", "Mexico", 0.4], ["Belo Horizonte", "Brazil", 0.3],
  ["Buenos Aires", "Argentina", 0.3], ["Medellín", "Colombia", 0.2], ["Johannesburg", "South Africa", 0.3],
  ["Zug", "Switzerland", 0.3], ["Hong Kong", "Hong Kong", 0.3], ["Ulaanbaatar", "Mongolia", 0.2],
  ["Dublin", "Ireland", 0.2], ["George Town", "Cayman Islands", 0.2], ["Road Town", "British Virgin Islands", 0.15],
  ["Port Louis", "Mauritius", 0.15], ["Stockholm", "Sweden", 0.15], ["Accra", "Ghana", 0.15],
];
const US_STATE_CODE = { Colorado: "CO", Idaho: "ID", Arizona: "AZ", Nevada: "NV", Washington: "WA", Utah: "UT" };
const HQ_PROVINCE = {
  "British Columbia, Canada": "BC", "Ontario, Canada": "ON", "Quebec, Canada": "QC", "Alberta, Canada": "AB",
  "Saskatchewan, Canada": "SK", "Nova Scotia, Canada": "NS", "Newfoundland and Labrador, Canada": "NL",
};

// The first entry of each profile names the company ("Gold", "Copper"...).
// Commodities are spelled as the app's vocabulary spells them
// (src/lib/format/fields.ts). With the second metals added below and the
// royalty companies' books, these come to the real mix: gold about two in
// three, copper one in three, silver three in ten.
const PROFILES = [
  [["Gold"], 30], [["Gold", "Silver"], 11], [["Gold", "Copper"], 11], [["Copper", "Gold", "Silver"], 4],
  [["Copper", "Gold", "Molybdenum"], 2.5], [["Copper"], 4.5], [["Copper", "Silver", "Zinc"], 1.5], [["Copper", "Zinc"], 1],
  [["Silver"], 3.5], [["Silver", "Lead", "Zinc"], 3.5], [["Silver", "Gold", "Lead", "Zinc"], 1.5], [["Zinc", "Lead"], 1.2],
  [["Nickel", "Copper", "Platinum/PGM", "Cobalt"], 2.2], [["Nickel", "Copper"], 1.3], [["Platinum/PGM", "Nickel"], 0.6],
  [["Lithium"], 4.5], [["Uranium"], 5.5], [["Rare Earths"], 1], [["Graphite"], 1], [["Iron"], 1],
  [["Potash"], 0.6], [["Coal"], 0.6], [["Diamond"], 0.6], [["Tungsten"], 0.5], [["Vanadium"], 0.4],
  [["Gold", "Antimony"], 0.6], [["Tin"], 0.3], [["Molybdenum", "Copper"], 0.5],
];
const ROYALTY_EXTRAS = ["Platinum/PGM", "Nickel", "Zinc", "Iron", "Potash", "Coal", "Uranium", "Lithium", "Cobalt", "Diamond"];

const DESCRIPTORS = {
  Gold: ["Gold", "Gold", "Gold Mines", "Goldfields", "Mining", "Minerals", "Resources", "Exploration", "Metals"],
  Silver: ["Silver", "Silver", "Silver Mining", "Mining", "Resources"],
  Copper: ["Copper", "Copper", "Metals", "Mining", "Resources"],
  Zinc: ["Zinc", "Base Metals", "Metals"],
  Nickel: ["Nickel", "Base Metals", "Metals"],
  "Platinum/PGM": ["Platinum", "PGM", "Metals"],
  Lithium: ["Lithium", "Lithium", "Battery Metals", "Critical Minerals"],
  Uranium: ["Uranium", "Uranium", "Energy", "Resources"],
  "Rare Earths": ["Rare Earths", "Critical Minerals"],
  Graphite: ["Graphite", "Critical Minerals"],
  Iron: ["Iron Ore", "Iron"],
  Potash: ["Potash"],
  Coal: ["Coal", "Met Coal"],
  Diamond: ["Diamonds"],
  Molybdenum: ["Molybdenum", "Metals"],
};
const GENERIC = ["Mining", "Minerals", "Resources", "Metals"];
const ROYALTY_DESCRIPTORS = ["Royalties", "Royalty", "Royalty & Streaming", "Streaming", "Precious Metals Royalties"];

// Coinages: a syllable and an English place-name ending. "mont" and "ross"
// are left out on purpose -- they make Belmont and Kinross.
const ONSETS = [
  "Ash", "Bal", "Bel", "Bran", "Brey", "Cal", "Car", "Cor", "Dal", "Dun", "Ell", "Esk", "Fal", "Fen", "Gal",
  "Gar", "Hal", "Har", "Ivel", "Jor", "Kel", "Kes", "Lan", "Lor", "Mar", "Mer", "Nor", "Orm", "Pell", "Quar",
  "Rav", "Ren", "Sal", "Sel", "Tal", "Tarn", "Tor", "Ul", "Val", "Ver", "Wen", "Wyr", "Yar", "Zel", "Bryn",
  "Cind", "Dray", "Eld", "Fyr", "Glen", "Hesk", "Ives", "Jarr", "Kell", "Lind", "Mor", "Nev", "Ost", "Pry",
  "Rhos", "Stav", "Tyl", "Vor", "Whit",
];
const CODAS = [
  "ford", "mere", "wick", "dale", "vane", "holt", "crest", "brook", "ridge", "stone", "moor", "ton", "by",
  "wyn", "vale", "field", "ness", "gate", "haven", "shaw", "lyn", "rock", "peak", "burn", "cliff", "ley",
  "wood", "garth", "thorpe", "beck", "fell", "combe", "hurst", "mark",
];
// First words real issuers already trade under, so a coinage cannot land on one.
const TAKEN_WORDS = new Set([
  "agnico", "alamos", "aris", "artemis", "aya", "barrick", "cameco", "capstone", "centerra", "denison",
  "dundee", "eldorado", "endeavour", "equinox", "ero", "filo", "fireweed", "foran", "fortuna", "franco",
  "hudbay", "iamgold", "integra", "ivanhoe", "kinross", "lundin", "marathon", "mcewen", "nexgen", "novagold",
  "orla", "osisko", "perpetua", "probe", "rupert", "sandstorm", "seabridge", "sigma", "silvercrest", "skeena",
  "snowline", "solaris", "taseko", "teck", "torex", "trilogy", "victoria", "vizsla", "wesdome", "wheaton",
  "calibre", "galiano", "orezone", "talon", "kodiak", "liberty", "montage", "westhaven", "sabre", "monarch",
  "troilus", "radisson", "wallbridge", "bonterra", "maple", "abcourt", "exploits", "sokoman", "goliath",
  "scottie", "ascot", "tudor", "amarc", "surge", "faraday", "banyan", "heliostar", "westgold", "kestrel",
  "belmont", "orford", "galway", "marvel", "matador", "signal", "revival", "eskay", "ashburton", "valemount",
  "torcrest", "calcrest", "glenstone", "harvest", "kelwood", "lindsay", "morcrest",
  // and names any reader knows from somewhere else
  "ashford", "ashgate", "ashton", "belhaven", "corby", "dalton", "fenwick", "garfield", "glenmark", "halford",
  "halton", "keswick", "norton", "selwyn", "valley", "renshaw", "whitfield", "harwood", "glendale", "norwood",
  "glenwood", "carlton", "whitby", "salford", "drayton", "wenlock", "ellesmere", "dunmore", "glenburn",
]);
// Tickers real mining issuers trade under, so an invented company never wears one.
const TAKEN_TICKERS = new Set((
  "ABX AEM AGI AYA ARIS ARTG ASM BTO CCO CXB DML DPM EDV ELD EQX ERO FCU FIL FNV FOM FRU FVI FWZ " +
  "GATO GAU HBM IMG ISO IVN KNT LAC LGD LUG LUN MAG MAI MKO NDM NFG NGD NGEX NXE OGC OGD ORE PAAS PPTA " +
  "PRB PRU RUP SBB SEA SGD SKE SLS SMT SNWL SSL SSRM TECK TFPM TKO TLO TML TXG VGCX VZLA WDO WPM WRN " +
  "AII ALS AMC ARG ASCU ATX BRVO CMMC CNC DSV EMX ETG FDY FURY GBR GGD GRSL HSTR III ITR KRR LAAC LIFT " +
  "MDI MND MTA NCU NEXG NOVA OSK PMET PTM PZG RBX SAU SBR SCZ SGML SPA STGO TGM THX TLG TUD VRB WGO WCU " +
  "XAU AAG AAU AFM AMX ARU AUY AXU BCM BGM BHS BRG BSX BKI CGG CGP CNX CPAU CRE DNG ECOR EDG EMO FPC GCU " +
  "GEMC GLDN GOT GPG GSVR HAN HPQ JG KDK KEN KTN LBC LGC LIO LMG MAE MAX MMS MNO MOZ MRZ NAM NCP NSR ORV " +
  "PEX PGM QTWO RCK REX RPX SAG SAM SBM SFR SGN SIE SLR SRL STE SVB SVE SVM TBK TGC TNR TSG TUO UCU UEX " +
  "URE VGD VIPR WEX WHY WKG WRLG XTG ZNC OR FM FR CG CS IE NG FF SIL LUM GMIN AUMN NEXT ODV FISH MTB " +
  "AMRQ NICU ELEF AUGO MAXX SLVR GOLD CUAU ATHA FIND HIGH LITH URNM URAN NFLD GLDX SILV COPR NICK ZINC " +
  "TORQ BULL BEAR MINE MINR CORE ROCK GEMS ORES METL GLEN"
).split(" "));

const AUDITOR_CLASS = {
  Deloitte: "big_four", PwC: "big_four", KPMG: "big_four", "Ernst & Young": "big_four",
  BDO: "national", "Grant Thornton": "national", MNP: "national", RSM: "national", "Baker Tilly": "national",
  "Davidson & Company": "regional", "De Visser Gray": "regional", "McGovern Hurley": "regional",
  "Crowe MacKay": "regional", DMCL: "regional", Smythe: "regional", "Manning Elliott": "regional",
  "Kingston Ross Pasnak": "regional", "MS Partners": "regional", Zeifmans: "regional", "D+H Group": "regional",
  DNTW: "regional", "Charlton & Company": "regional", "Wasserman Ramsay": "regional", SRCO: "regional",
};
// The firms the practice's workbook can carry: the parser's own vocabulary
// (mmparser/aliases.py FIRM_ALIASES). Any other firm reaches a period only
// through research, as it would for real.
const WORKBOOK_FIRMS = new Set([
  "Deloitte", "PwC", "KPMG", "Ernst & Young", "BDO", "Grant Thornton", "MNP", "Davidson & Company",
  "McGovern Hurley", "Crowe MacKay", "Kingston Ross Pasnak", "MS Partners", "D+H Group", "Zeifmans", "Smythe", "DNTW",
]);
const TAIL = [
  ["Manning Elliott", 3], ["Kingston Ross Pasnak", 1.5], ["MS Partners", 1.5], ["Zeifmans", 1.2], ["D+H Group", 1],
  ["DNTW", 1], ["Baker Tilly", 1.2], ["Charlton & Company", 1], ["Wasserman Ramsay", 1], ["SRCO", 1],
];
const tail = (share) => TAIL.map(([firm, w]) => [firm, (w * share) / 13.4]);
// Who audits a company of each size; null is "not yet known", which research
// has reached least among the smallest.
const AUDITOR_MIX = {
  mega: [["PwC", 30], ["KPMG", 22], ["Deloitte", 22], ["Ernst & Young", 18], ["BDO", 4], ["Grant Thornton", 4]],
  large: [["PwC", 32], ["KPMG", 20], ["Deloitte", 16], ["Ernst & Young", 12], ["MNP", 6], ["BDO", 4],
          ["Grant Thornton", 4], ["Davidson & Company", 4], ["RSM", 2]],
  mid: [["PwC", 28], ["KPMG", 12], ["Davidson & Company", 12], ["MNP", 9], ["Deloitte", 8], ["Grant Thornton", 5],
        ["BDO", 5], ["Ernst & Young", 5], ["De Visser Gray", 3], ["McGovern Hurley", 2], ["RSM", 2],
        ["Crowe MacKay", 1], ["Smythe", 1], [null, 3], ...tail(4)],
  small: [["PwC", 18], ["Davidson & Company", 18], ["KPMG", 8], ["MNP", 8], ["De Visser Gray", 6],
          ["Grant Thornton", 5], ["BDO", 5], ["McGovern Hurley", 4], ["Deloitte", 3], ["RSM", 3], ["Crowe MacKay", 3],
          ["DMCL", 3], ["Smythe", 2], ["Ernst & Young", 2], [null, 8], ...tail(5)],
  micro: [["Davidson & Company", 17], ["PwC", 10], ["MNP", 7], ["De Visser Gray", 6], ["KPMG", 5], ["BDO", 4],
          ["McGovern Hurley", 4], ["DMCL", 4], ["Grant Thornton", 3], ["RSM", 3], ["Crowe MacKay", 3],
          ["Smythe", 2.5], ["Deloitte", 1], ["Ernst & Young", 1], [null, 22], ...tail(7.5)],
};

/* ------------------------------------------------------- who is where */

const band = (cap) => cap >= 10 * B ? "mega" : cap >= 2 * B ? "large"
  : cap >= 500 * M ? "mid" : cap >= 200 * M ? "small" : "micro";

/**
 * A market cap at or above `lo`, read from u in [0, 1). Above the line caps
 * fall away as a power law, and a = 0.55 gives a quarter at C$100M the shape
 * of this market: about 8% over C$10B, 12% at C$2-10B, 25% at C$500M-2B. Over C$10B
 * the tail is steeper, so a handful of majors sit over a long middle rather
 * than dozens.
 */
function capFrom(lo, u, a = 0.55) {
  const x = lo * (1 - u) ** (-1 / a);
  if (x < 10 * B) return x;
  for (;;) {
    const major = 10 * B * (1 - rand()) ** (-1 / 1.1);
    if (major <= 130 * B) return major;
  }
}

/** The same law, truncated to [lo, hi). */
function capWithin(lo, hi, u, a = 0.55) {
  return lo * (1 - u * (1 - (hi / lo) ** -a)) ** (-1 / a);
}

// Q3 is drawn at C$200M and Q4 at C$100M, so most of Q4's newcomers are in
// range only because the line moved -- which is what the period shows.
const cohort = {
  continuing: 243 + intBetween(0, 4),
  acquired: intBetween(5, 7),        // taken over between the quarters
  fellBelow: intBetween(3, 5),       // under C$100M by August
  under: 85 + intBetween(0, 4),      // C$100-200M: in range because the line moved
  crossed: intBetween(6, 8),         // under C$200M in May, over it by August
  listed: intBetween(3, 4),          // new listings and spin-outs
};

const companies = [];
const enlist = (fate, n, caps) => {
  for (const u of strata(n)) companies.push({ fate, ...caps(u) });
};
enlist("continuing", cohort.continuing, (u) => ({ cap3: capFrom(200 * M, u) }));
enlist("acquired", cohort.acquired, (u) => ({ cap3: capWithin(250 * M, 4 * B, u) }));
enlist("fell_below", cohort.fellBelow, (u) => ({ cap3: capWithin(200 * M, 280 * M, u) }));
enlist("entrant", cohort.under, (u) => ({ cap4: capWithin(100 * M, 200 * M, u) }));
enlist("entrant", cohort.crossed, (u) => ({ cap4: 200 * M + 90 * M * u }));
enlist("listed", cohort.listed, (u) => ({ cap4: capWithin(250 * M, 1.6 * B, u) }));
for (const c of companies) {
  c.inQ3 = ["continuing", "acquired", "fell_below"].includes(c.fate);
  c.inQ4 = ["continuing", "entrant", "listed"].includes(c.fate);
  // What a company's other traits are drawn against: its size when first seen.
  c.size = band(c.cap3 ?? c.cap4);
}
const inQ3 = companies.filter((c) => c.inQ3);
const inQ4 = companies.filter((c) => c.inQ4);
const continuing = companies.filter((c) => c.fate === "continuing");
const newcomers = companies.filter((c) => c.fate === "entrant" || c.fate === "listed");

/* ------------------------------------------------------ what they are */

const BANDS = ["mega", "large", "mid", "small", "micro"];
const inBand = (list, b) => list.filter((c) => c.size === b);

// Royalty and streaming companies hold interests rather than properties, and
// most hold no property at all: the footprint the classifier calls "none".
// That has no property evidence, and the footprint chart needs 95% of a
// quarter to have some, so the count is set rather than drawn.
const NO_PROPERTY_SHARE = 0.047;
const noPropertyQ3 = Math.round(NO_PROPERTY_SHARE * inQ3.length);
const noPropertyNew = Math.max(0, Math.floor(NO_PROPERTY_SHARE * inQ4.length) - noPropertyQ3);
const ROYALTY_WEIGHT = { mega: 12, large: 9, mid: 6, small: 4, micro: 3 };
const royaltyBoth = sample(continuing, noPropertyQ3 + 5, (c) => ROYALTY_WEIGHT[c.size]);
const royaltyNew = sample(newcomers, noPropertyNew + 1, (c) => ROYALTY_WEIGHT[c.size]);
for (const c of [...royaltyBoth, ...royaltyNew]) c.kind = "royalty";
for (const c of [...royaltyBoth.slice(0, noPropertyQ3), ...royaltyNew.slice(0, noPropertyNew)]) c.noProperties = true;

const KIND_MIX = {
  mega: [["producer", 85], ["developer", 9], ["explorer", 6]],
  large: [["producer", 65], ["developer", 22], ["explorer", 13]],
  mid: [["producer", 32], ["developer", 32], ["explorer", 36]],
  small: [["producer", 12], ["developer", 31], ["explorer", 57]],
  micro: [["producer", 6], ["developer", 26], ["explorer", 68]],
};
for (const b of BANDS) {
  for (const [c, kind] of allot(inBand(companies, b).filter((x) => !x.kind), KIND_MIX[b])) c.kind = kind;
}

for (const c of companies.filter((x) => x.kind === "royalty")) {
  c.main = "Gold";
  const book = ["Gold", ...(chance(0.75) ? ["Silver"] : []), ...(chance(0.55) ? ["Copper"] : []),
                ...sample(ROYALTY_EXTRAS, intBetween(0, 3))];
  c.commodities = [...new Set(book)].sort();
}
for (const [c, profile] of allot(companies.filter((x) => x.kind !== "royalty"), PROFILES)) {
  const list = new Set(profile);
  // The second metals a long run of assays turns up.
  if (list.has("Copper") && !list.has("Gold") && chance(0.12)) list.add("Gold");
  if (list.has("Silver") && !list.has("Gold") && chance(0.1)) list.add("Gold");
  if (list.has("Gold") && !list.has("Silver") && chance(0.03)) list.add("Silver");
  if (list.has("Gold") && !list.has("Copper") && chance(0.06)) list.add("Copper");
  c.main = profile[0];
  c.commodities = [...list].sort();
}

for (const [c, hq] of allot(companies, HEAD_OFFICES.map(([city, region, w]) => [{ city, region }, w]))) c.hq = hq;
const canadianHq = (c) => c.hq.region.endsWith(", Canada");
const usHq = (c) => c.hq.region.endsWith(", United States");

/* --------------------------------------------------------- where they dig */

const emptyRegions = () => Object.fromEntries(REGION_KEYS.map((k) => [k, []]));
const cloneRegions = (r) => Object.fromEntries(REGION_KEYS.map((k) => [k, [...r[k]]]));
const anyRegion = (r) => REGION_KEYS.some((k) => r[k].length > 0);
const abroad = (r) => REGION_KEYS.some((k) => k !== "CANADA" && r[k].length > 0);
function footprintOf(r) {
  const ca = r.CANADA.length > 0;
  return ca && abroad(r) ? "both" : ca ? "canada" : abroad(r) ? "abroad" : "none";
}
function regionsWith(entries) {
  const r = emptyRegions();
  for (const [group, name] of entries) if (!r[group].includes(name)) r[group].push(name);
  return r;
}

function provincesFor(c, n) {
  const home = HQ_PROVINCE[c.hq.region];
  return sample(PROVINCES, n, ([p, w]) => (p === home ? 3 * w : w)).map(([p]) => p);
}

/** Foreign ground, clustered: a second property is usually in the same part of the world. */
function foreignFor(c, n) {
  const us = c.hq.region.match(/^(.+), United States$/);
  const home = us ? US_STATE_CODE[us[1]] : canadianHq(c) ? null : c.hq.region;
  const chosen = [];
  const homeEntry = FOREIGN.find(([, name]) => name === home);
  if (homeEntry && chance(0.7)) chosen.push(homeEntry);
  while (chosen.length < n) {
    const pool = FOREIGN.filter((f) => !chosen.includes(f));
    const near = chosen.length > 0 && chance(0.6) ? pool.filter(([g]) => g === chosen[0][0]) : [];
    chosen.push(sample(near.length > 0 ? near : pool, 1, ([, , w]) => w)[0]);
  }
  return chosen.map(([group, name]) => [group, name]);
}

const howManyProvinces = () => weighted([[1, 72], [2, 21], [3, 6], [4, 1]]);
const howManyForeign = (c) => weighted(c.size === "mega"
  ? [[1, 25], [2, 30], [3, 25], [4, 12], [5, 8]]
  : [[1, 52], [2, 27], [3, 13], [4, 5], [5, 3]]);

// Where each company with ground has it, in the population's proportions:
// about 59% abroad only, 22% Canada only and 14% both (the royalty books
// among them), the last 5% the royalty companies with none. A company with
// its head office abroad is rarely Canada-only; a major that produces is more
// often in both.
const withGround = companies.filter((c) => c.kind !== "royalty");
const canadaOnly = Math.round(0.22 * companies.length);
const both = Math.round(0.14 * companies.length) - companies.filter((c) => c.kind === "royalty" && !c.noProperties).length;
const footprints = allot(withGround, [["canada", canadaOnly], ["both", both], ["abroad", withGround.length - canadaOnly - both]],
  (c, fp) => fp === "canada" ? (canadianHq(c) ? 1 : 0.03)
    : fp === "both" ? (canadianHq(c) ? 1 : 0.4) * (["mega", "large"].includes(c.size) && c.kind === "producer" ? 2.5 : 1)
    : 1);

for (const c of companies) {
  if (c.noProperties) { c.regions3 = emptyRegions(); continue; }
  if (c.kind === "royalty") {
    c.regions3 = regionsWith([
      ...provincesFor(c, intBetween(2, 4)).map((p) => ["CANADA", p]),
      ...foreignFor(c, intBetween(3, 7)),
    ]);
    continue;
  }
  const fp = footprints.get(c);
  c.regions3 = regionsWith([
    ...(fp !== "abroad" ? provincesFor(c, howManyProvinces()).map((p) => ["CANADA", p]) : []),
    ...(fp !== "canada" ? foreignFor(c, howManyForeign(c)) : []),
  ]);
}

/* ------------------------------------------------------ a quarter's move */

// Large caps move least; gold and silver had a good quarter and lithium did
// not. Thirty majors carry most of the money, so their dice alone could swing
// the quarter by several points: the market's move is set, +6.5% across the
// companies in both quarters, and the dice decide who carried it.
const MARKET_MOVE = 1.065;
function quarterMove(c) {
  const sigma = { mega: 0.09, large: 0.15, mid: 0.21, small: 0.26, micro: 0.3 }[c.size];
  const drift = 0.04
    + (c.commodities.includes("Gold") || c.commodities.includes("Silver") ? 0.025 : 0)
    - (c.main === "Lithium" ? 0.09 : 0);
  return Math.exp(drift + sigma * gauss());
}
for (const c of continuing) c.cap4 = c.cap3 * quarterMove(c);
{
  const level = (MARKET_MOVE * continuing.reduce((a, c) => a + c.cap3, 0)) /
                continuing.reduce((a, c) => a + c.cap4, 0);
  // Still in range at C$100M: the ones that were not are this quarter's drop-outs.
  for (const c of continuing) c.cap4 = Math.max(105 * M, c.cap4 * level);
}
const round = (n) => Math.round(n / 10_000) * 10_000;
for (const c of companies) {
  if (c.cap3) c.cap3 = round(c.cap3);
  if (c.cap4) c.cap4 = round(c.cap4);
}
/** The cap a company is measured by now: Q4's, or its last. */
const capNow = (c) => c.cap4 ?? c.cap3;

/* ------------------------------------------------------------ listings */

// The TSX holds every major and few of the smallest; the venture exchange
// the rest -- a little over half the population at a C$100M line.
const TSX_SHARE = { mega: 1, large: 0.95, mid: 0.62, small: 0.26, micro: 0.12 };
const GRADUATE_SHARE = { mega: 0.15, large: 0.5, mid: 0.75, small: 0.85, micro: 0.9 };
for (const b of BANDS) {
  const share = TSX_SHARE[b];
  for (const [c, exchange] of allot(inBand(companies, b), [["TSX", share], ["TSXV", 1 - share]])) c.exchange = exchange;
}
for (const c of companies) c.graduate = c.exchange === "TSX" && canadianHq(c) && chance(GRADUATE_SHARE[c.size]);
// Three TSXV companies that had the quarter to graduate to the TSX.
for (const c of sample(continuing.filter((x) => x.exchange === "TSXV" && x.cap4 >= 250 * M && x.cap4 > x.cap3 * 1.1), 3)) {
  c.graduatesInQ4 = true;
}
const exchangeAt = (c, q) => (q === Q4 && c.graduatesInQ4 ? "TSX" : c.exchange);
const graduateAt = (c, q) => (q === Q4 && c.graduatesInQ4 ? true : c.graduate);

/* --------------------------------------------------------------- names */

const usedFirst = new Set();
const usedStems = new Set();
const usedTickers = new Set();

function descriptorFor(c) {
  if (c.kind === "royalty") return pick(ROYALTY_DESCRIPTORS);
  return pick(DESCRIPTORS[c.main] ?? GENERIC);
}

function suffixFor(c) {
  if (c.hq.region === "Australia") return pick(["Limited", "Ltd"]);
  if (c.hq.region === "United Kingdom") return "plc";
  return weighted([["Corp.", 40], ["Inc.", 25], ["Ltd.", 22], ["Limited", 6]]);
}

/**
 * Four letters, always. Three-letter symbols are dense enough on the TSX and
 * the venture exchange that one in ten invented ones would be some real
 * issuer's; four-letter ones are sparse enough that the blocklist covers the
 * ones in this trade.
 */
function tickerFor(first, descriptor) {
  const w = first.toUpperCase();
  const d = descriptor.toUpperCase().replace(/[^A-Z]/g, "");
  const cons = w.slice(1).replace(/[AEIOUY]/g, "");
  const options = [w.slice(0, 4), w[0] + cons.slice(0, 3), w.slice(0, 3) + d[0], w[0] + cons.slice(0, 2) + d[0],
                   w.slice(0, 2) + d.slice(0, 2), w[0] + cons[0] + d.slice(0, 2)];
  const free = (t) => /^[A-Z]{4}$/.test(t) && !usedTickers.has(t) && !TAKEN_TICKERS.has(t);
  let ticker = options.find(free);
  while (!ticker) {
    const t = Array.from({ length: 4 }, () => String.fromCharCode(65 + intBetween(0, 25))).join("");
    if (free(t)) ticker = t;
  }
  usedTickers.add(ticker);
  return ticker;
}

// Unique by first word and by the stem the merge screen compares, so no two
// invented companies look like one company under two names.
for (const c of companies) {
  for (;;) {
    const onset = pick(ONSETS);
    const coda = pick(CODAS);
    const first = onset + coda;
    // Not Nevvale or Pellley: a doubled letter at the seam reads as a typo.
    if (onset.at(-1) === coda[0] || /(.)\1\1/.test(first)) continue;
    if (usedFirst.has(first) || TAKEN_WORDS.has(first.toLowerCase())) continue;
    const descriptor = descriptorFor(c);
    const name = `${first} ${descriptor} ${suffixFor(c)}`;
    const stem = nameStem(normName(name));
    if (usedStems.has(stem)) continue;
    usedFirst.add(first);
    usedStems.add(stem);
    c.name = name;
    c.slug = `${first}${descriptor}`.toLowerCase().replace(/[^a-z]/g, "");
    c.ticker = tickerFor(first, descriptor);
    break;
  }
  c.website = chance(0.88) ? `https://www.${c.slug}.example` : null;
}

/* ------------------------------------------------------------ auditors */

for (const b of BANDS) {
  for (const [c, firm] of allot(inBand(companies, b), AUDITOR_MIX[b])) c.auditor = firm;
}

const sumCap = (list) => list.reduce((a, c) => a + capNow(c), 0);
// Deloitte's book leans to size: about 7% of the companies and 15% of the
// money. Which majors it holds decides the second number, and one C$60B major
// either way moves it four points, so it is settled by trading clients with
// the other Big 4 -- one Deloitte company for one of theirs, which leaves
// every firm's count where the mix put it.
{
  const total = sumCap(inQ4);
  for (let i = 0; i < 6; i++) {
    const share = sumCap(inQ4.filter((c) => c.auditor === "Deloitte")) / total;
    if (share >= 0.14 && share <= 0.16) break;
    let best = null;
    for (const ours of inQ4.filter((c) => c.auditor === "Deloitte")) {
      for (const theirs of inQ4.filter((c) => ["PwC", "KPMG", "Ernst & Young"].includes(c.auditor))) {
        const after = share + (capNow(theirs) - capNow(ours)) / total;
        if (!best || Math.abs(after - 0.15) < Math.abs(best.after - 0.15)) best = { ours, theirs, after };
      }
    }
    [best.ours.auditor, best.theirs.auditor] = [best.theirs.auditor, "Deloitte"];
  }
}
// The auditor cross-tab needs 90% of a quarter researched to be drawn. Keep
// the gap a little under a tenth, the largest unknowns found first.
{
  const unknown = inQ4.filter((c) => c.auditor === null).sort((a, b) => capNow(b) - capNow(a));
  const over = unknown.length - Math.floor(0.092 * inQ4.length);
  for (const c of unknown.slice(0, Math.max(0, over))) {
    c.auditor = weighted(AUDITOR_MIX[c.size].filter(([firm]) => firm !== null));
  }
}
// The practice's workbook names the auditor of most of its book; research
// found the rest. Newcomers were never in the book.
const WORKBOOK_SHARE = { mega: 0.95, large: 0.85, mid: 0.65, small: 0.5, micro: 0.4 };
for (const c of companies) c.auditorInWorkbook = c.inQ3 && chance(WORKBOOK_SHARE[c.size]);

// Twenty-four months of auditor changes, the strongest whitespace signal
// there is: Deloitte wins and losses, companies outgrowing their first firm
// for a Big 4 one, and the usual lateral churn. A few land between the two
// quarters, so Q4's book differs from Q3's.
const WHEN = {
  early: ["2024-06-01", "2024-08-30"],     // inside Q3's 24 months, outside Q4's
  window: ["2024-09-01", "2026-05-31"],    // inside both
  between: ["2026-06-01", "2026-08-28"],   // after Q3's as-of date
};
const EVENTS = [
  { to: "Deloitte", from: "KPMG", when: "between", sizes: ["mega", "large", "mid"] },
  { to: "Deloitte", from: "PwC", when: "window", sizes: ["large", "mid"] },
  { to: "Deloitte", from: "Davidson & Company", when: "window", sizes: ["mid", "large"] },
  { to: "Deloitte", from: "Ernst & Young", when: "window", sizes: ["mid", "large", "mega"] },
  { to: "PwC", from: "Deloitte", when: "between", sizes: ["mid", "large"] },
  { to: "KPMG", from: "Deloitte", when: "window", sizes: ["mid", "small", "large"] },
  { to: "BDO", from: "Deloitte", when: "window", sizes: ["small", "micro", "mid"] },
  { to: "PwC", from: "Davidson & Company", when: "window", sizes: ["mid", "large"] },
  { to: "KPMG", from: "De Visser Gray", when: "window", sizes: ["mid", "large"] },
  { to: "Ernst & Young", from: "Smythe", when: "window", sizes: ["mid", "large", "small"] },
  { to: "PwC", from: "McGovern Hurley", when: "window", sizes: ["mid", "small"] },
  { to: "KPMG", from: "DMCL", when: "between", sizes: ["mid", "small"] },
  { to: "PwC", from: "Crowe MacKay", when: "window", sizes: ["mid", "small"] },
];
const PEERS = {
  big_four: ["PwC", "KPMG", "Ernst & Young"],
  other: ["BDO", "Grant Thornton", "MNP", "Davidson & Company", "De Visser Gray", "McGovern Hurley",
          "Crowe MacKay", "DMCL", "Smythe", "Manning Elliott"],
};
for (const e of EVENTS) {
  const pool = (e.when === "window" ? inQ4 : continuing).filter((c) => c.auditor === e.to && !c.change);
  const sized = pool.filter((c) => e.sizes.includes(c.size));
  const [c] = sample(sized.length > 0 ? sized : pool, 1);
  if (c) c.change = { date: dateIn(WHEN[e.when]), from: e.from };
}
for (const [when, n] of [["window", 15], ["between", 2], ["early", 3]]) {
  const pool = (when === "window" ? inQ4 : continuing)
    .filter((c) => c.auditor && c.auditor !== "Deloitte" && !c.change);
  for (const c of sample(pool, n)) {
    const peers = PEERS[AUDITOR_CLASS[c.auditor] === "big_four" ? "big_four" : "other"].filter((f) => f !== c.auditor);
    c.change = { date: dateIn(WHEN[when]), from: pick(peers) };
  }
}
const changedAfter = (c, q) => c.change && c.change.date > q.asOf;
const auditorAt = (c, q) => (changedAfter(c, q) ? c.change.from : c.auditor);

/**
 * The year a firm was first appointed, for an engagement with no change in
 * the last two years: so 2023 at the latest. Big 4 engagements run longest; a
 * few go back to the early nineties.
 */
function tenureStart(firm) {
  const mean = AUDITOR_CLASS[firm] === "big_four" ? 9 : 4;
  const years = 3 - mean * Math.log(1 - rand());
  return Math.max(1993, Math.min(2023, 2026 - Math.round(years)));
}

/* ---------------------------------------------------------- research */

// What research found, and when: a value is found by Q4, and 8% of what is
// known by Q4 was not yet found in Q3 -- the research catching up.
const FX = { CAD: 1, USD: 0.73 };
const money = (amount, currency) => ({ amount: Math.round(amount / 10) * 10, currency, fiscal_year: 2025 });
const SEC_SHARE = { mega: 0.9, large: 0.6, mid: 0.22, small: 0.1, micro: 0.05 };
const FEE_SHARE = { mega: 0.62, large: 0.52, mid: 0.42, small: 0.34, micro: 0.27 };
const YEAR_END_SHARE = { mega: 0.85, large: 0.78, mid: 0.68, small: 0.6, micro: 0.52 };
const ASSETS_SHARE = { mega: 0.45, large: 0.34, mid: 0.22, small: 0.16, micro: 0.1 };
const OTHER_YEAR_ENDS = [["06-30", 30], ["09-30", 18], ["03-31", 15], ["07-31", 8], ["08-31", 7], ["10-31", 6],
                         ["01-31", 5], ["02-28", 4], ["04-30", 4], ["05-31", 3]];

for (const c of companies) {
  const known = new Set();
  const cap = capNow(c);
  const producing = c.kind === "producer" || c.kind === "royalty";
  c.currency = usHq(c) ? (chance(0.95) ? "USD" : "CAD")
    : producing && cap >= 1 * B ? (chance(0.6) ? "USD" : "CAD")
    : !canadianHq(c) ? (chance(0.5) ? "USD" : "CAD")
    : chance(0.12) ? "USD" : "CAD";
  const fx = FX[c.currency];

  if (chance(0.88)) known.add("head_office_location");
  if (chance(0.92)) known.add("sec_registrant");
  // A nine-digit CIK starting 99 belongs to nobody: EDGAR's are seven digits today.
  c.sec = (usHq(c) ? chance(0.8) : chance(SEC_SHARE[c.size]))
    ? { registrant: true,
        form: usHq(c) ? "10-K" : c.exchange === "TSX" && chance(0.85) ? "40-F" : "20-F",
        cik: `99${String(intBetween(0, 9_999_999)).padStart(7, "0")}` }
    : { registrant: false, form: null, cik: null };
  if (chance(YEAR_END_SHARE[c.size])) known.add("fiscal_year_end");
  c.yearEnd = c.hq.region === "Australia" ? (chance(0.85) ? "06-30" : "12-31")
    : chance(0.78) ? "12-31" : weighted(OTHER_YEAR_ENDS);

  if (c.auditor) {
    // Fees are read from the circular's table, which names the auditor: no
    // fee is known where the auditor is not.
    if (chance(FEE_SHARE[c.size])) {
      known.add("audit_fee");
      if (chance(0.42)) known.add("tax_fee");
      if (chance(0.42)) known.add("audit_related_fee");
      if (chance(0.42)) known.add("other_fee");
    }
    if (c.change ? chance(0.75) : chance(0.34)) known.add("auditor_since");
    if (c.change || chance(0.4)) known.add("auditor_change");
  }
  const scale = 10 ** (4.6 + 0.62 * (Math.log10(cap) - 8));
  const effort = { producer: 1.7, royalty: 0.8, developer: 1, explorer: 0.75 }[c.kind];
  const audit = scale * effort * Math.exp(0.25 * gauss()) * fx;
  c.fees = {
    audit_fee: money(audit, c.currency),
    tax_fee: money(audit * between(0.03, 0.3), c.currency),
    audit_related_fee: money(audit * between(0.04, 0.35), c.currency),
    other_fee: money(chance(0.25) ? 0 : audit * between(0.01, 0.12), c.currency),
  };
  c.since = c.auditor ? (c.change ? Number(c.change.date.slice(0, 4)) : tenureStart(c.auditor)) : null;
  c.sinceBefore = c.change ? tenureStart(c.change.from) : null;

  if (chance(ASSETS_SHARE[c.size] * (producing ? 1.8 : 0.6))) {
    known.add("total_assets");
    if (chance(0.8)) known.add("net_income");
    if (producing && chance(0.9)) known.add("total_revenue");
  }
  const assetsRatio = { producer: between(0.35, 1.2), royalty: between(0.3, 0.7),
                        developer: between(0.2, 0.7), explorer: between(0.08, 0.35) }[c.kind];
  const revenue = c.kind === "producer" ? cap * between(0.15, 0.6) : c.kind === "royalty" ? cap * between(0.04, 0.09) : 0;
  const income = c.kind === "producer" ? revenue * between(-0.08, 0.32)
    : c.kind === "royalty" ? revenue * between(0.3, 0.6) : -cap * between(0.01, 0.06);
  c.financials = {
    total_assets: money(cap * assetsRatio * fx, c.currency),
    total_revenue: money(revenue * fx, c.currency),
    net_income: money(income * fx, c.currency),
  };
  const anyMoney = ["audit_fee", "total_assets"].some((f) => known.has(f));
  if (anyMoney || chance(0.3)) known.add("reporting_currency");

  c.known = known;
  c.lateFinds = new Set([...known].filter(() => chance(0.08)));
}

/* --------------------------------------------------------------- stages */

const FLAGS = ["exploration", "development", "production", "royalty_streaming"];
const NO_STAGE = { exploration: false, development: false, production: false, royalty_streaming: false };
const DECISIVE = { producer: "production", developer: "development", explorer: "exploration" };

function flagsFor(kind) {
  switch (kind) {
    case "producer": return { exploration: chance(0.78), development: chance(0.35), production: true, royalty_streaming: false };
    case "developer": return { exploration: chance(0.82), development: true, production: false, royalty_streaming: false };
    default: return { exploration: true, development: false, production: false, royalty_streaming: false };
  }
}

/** Research that established the stage that decides the tier, and left one or two others open. */
function withGaps(flags, kind) {
  const open = sample(FLAGS.filter((f) => f !== DECISIVE[kind]), chance(0.7) ? 1 : 2);
  return Object.fromEntries(FLAGS.map((f) => [f, open.includes(f) ? null : flags[f]]));
}

// Research has not reached a few companies, mostly the smallest and newest.
// The tier chart needs stage evidence for 95% of a quarter.
const STAGE_PRIORITY = { mega: 0.1, large: 0.2, mid: 1, small: 3, micro: 3 };
const unresearched3 = new Set(sample(inQ3.filter((c) => c.kind !== "royalty"),
  Math.round(0.034 * inQ3.length), (c) => STAGE_PRIORITY[c.size]));
const unresearched4 = new Set(sample(inQ4.filter((c) => c.kind !== "royalty" && !unresearched3.has(c)),
  Math.round(0.03 * inQ4.length), (c) => (c.fate === "continuing" ? 0.3 : 4)));

// What moved between the quarters, for the migration view. A lower tier
// number is a better tier, so a mine declaring production moves "up".
for (const c of companies) c.kind4 = c.kind;
const steady = (kind) => continuing.filter((c) => c.kind === kind && c.kind4 === kind &&
  !unresearched3.has(c) && !unresearched4.has(c));
for (const c of sample(steady("developer"), 5, (x) => (x.cap3 >= 300 * M ? 3 : 1))) c.kind4 = "producer";
for (const c of sample(steady("explorer"), 6)) c.kind4 = "developer";
for (const c of sample(steady("producer"), 2)) c.kind4 = "developer";   // operations suspended
for (const c of sample(steady("developer"), 1)) c.kind4 = "explorer";   // a project shelved

// One company per quarter whose research established no stage at all.
const [conflicted3] = sample(steady("explorer"), 1);
const [conflicted4] = sample(newcomers.filter((c) => c.kind === "explorer" && !unresearched4.has(c)), 1);

for (const c of companies) {
  if (c.kind === "royalty") continue;   // the workbook's royalty column decides it
  const flags3 = flagsFor(c.kind);
  const flags4 = c.kind4 === c.kind ? flags3 : flagsFor(c.kind4);
  const gaps3 = chance(0.18) ? withGaps(flags3, c.kind) : null;
  // Some of Q3's gaps were closed by Q4; a changed stage was researched afresh.
  const gaps4 = c.kind4 !== c.kind ? (chance(0.1) ? withGaps(flags4, c.kind4) : null)
    : gaps3 && chance(0.7) ? gaps3 : null;
  c.stage3 = !c.inQ3 || unresearched3.has(c) ? null : c === conflicted3 ? NO_STAGE : gaps3 ?? flags3;
  c.stage4 = !c.inQ4 || unresearched4.has(c) ? null : c === conflicted4 ? NO_STAGE : gaps4 ?? flags4;
}

/* ------------------------------------------------- ground bought and sold */

function withForeign(c, r) {
  const next = cloneRegions(r);
  for (const [group, name] of foreignFor(c, 1)) if (!next[group].includes(name)) next[group].push(name);
  return next;
}
function withProvince(c, r) {
  const next = cloneRegions(r);
  const [p] = provincesFor(c, 1);
  if (!next.CANADA.includes(p)) next.CANADA.push(p);
  return next;
}
const producers = continuing.filter((c) => c.kind === "producer" && c.kind4 === "producer");
for (const c of sample(producers.filter((x) => footprintOf(x.regions3) === "canada"), 2)) c.regions4 = withForeign(c, c.regions3);
for (const c of sample(producers.filter((x) => footprintOf(x.regions3) === "abroad"), 1)) c.regions4 = withProvince(c, c.regions3);
for (const c of sample(producers.filter((x) => footprintOf(x.regions3) === "both"), 1)) {
  c.regions4 = { ...cloneRegions(c.regions3), CANADA: [] };   // sold its Canadian mine
}
// A few stake new ground in a part of the world they already work in.
for (const c of sample(continuing.filter((x) => !x.regions4 && footprintOf(x.regions3) === "abroad"),
                       Math.round(0.04 * continuing.length))) {
  const next = cloneRegions(c.regions3);
  const group = REGION_KEYS.find((k) => k !== "CANADA" && next[k].length > 0);
  const options = FOREIGN.filter(([g, name]) => g === group && !next[g].includes(name));
  if (options.length > 0) next[group].push(sample(options, 1, ([, , w]) => w)[0][1]);
  c.regions4 = next;
}
for (const c of companies) c.regions4 ??= c.regions3;

/* ---------------------------------------------------- the two quarters */

const capAt = (c, q) => (q === Q3 ? c.cap3 : c.cap4);

function payloadFor(q) {
  const members = companies.filter((c) => (q === Q3 ? c.inQ3 : c.inQ4))
    .sort((a, b) => capAt(b, q) - capAt(a, q));
  return {
    kind: "workbook",
    period: q.asOf,
    companies: members.map((c, i) => {
      const regions = q === Q3 ? c.regions3 : c.regions4;
      const firm = auditorAt(c, q);
      const auditor = firm && c.auditorInWorkbook && WORKBOOK_FIRMS.has(firm) ? firm : null;
      return {
        ticker: c.ticker, exchange: exchangeAt(c, q), name: c.name, ordinal: i + 1,
        market_cap: capAt(c, q),
        // The workbook's royalty column is the one stage it carries.
        stages: c.kind === "royalty" ? ["royalty_streaming"] : [],
        stage_evidence: c.kind === "royalty" ? "complete" : "none",
        property_evidence: anyRegion(regions) ? "complete" : "none",
        regions,
        region_provenance: Object.fromEntries(REGION_KEYS.map((k) => [k, regions[k].length ? "extract" : "absent"])),
        commodities: c.commodities,
        venture_graduate: graduateAt(c, q),
        auditor, auditor_class: auditor ? AUDITOR_CLASS[auditor] : null,
        website: c.website,
        dtt_market: deloitteMarketFor(c.hq.region).market,
        head_office_region: c.hq.region,
        entity_id: null,
        tier_workbook: null, footprint_workbook: null,
      };
    }),
  };
}

/** Every researched value for one company in one quarter, as the override that records it. */
function research(c, q) {
  const out = [];
  const filing = (name) => `https://example.invalid/filings/${c.ticker.toLowerCase()}/${name}`;
  const put = (fieldKey, value, what, url) =>
    out.push({ fieldKey, value, reason: `Synthetic showcase value: ${what}. ${url}` });
  const found = (field) => c.known.has(field) && (q === Q4 || !c.lateFinds.has(field));

  const stage = q === Q3 ? c.stage3 : c.stage4;
  if (stage) put("stage_evidence_state", stage, "stage of operations, from the annual information form", filing("aif-2025.pdf"));
  const firm = auditorAt(c, q);
  if (firm && !(c.auditorInWorkbook && WORKBOOK_FIRMS.has(firm))) {
    put("auditor", firm, "auditor named in the independent auditor's report", filing("financial-statements-2025.pdf"));
  }
  if (found("head_office_location")) {
    put("head_office_location", c.hq.city, "head office address, from the company's contact page",
        `https://example.invalid/${c.slug}/contact`);
  }
  for (const fee of ["audit_fee", "tax_fee", "audit_related_fee", "other_fee"]) {
    if (found(fee)) put(fee, c.fees[fee], "auditor's fees table in the management information circular", filing("circular-2026.pdf"));
  }
  if (found("fiscal_year_end")) put("fiscal_year_end", c.yearEnd, "year-end of the audited financial statements", filing("financial-statements-2025.pdf"));
  if (found("auditor_since")) {
    put("auditor_since", changedAfter(c, q) ? c.sinceBefore : c.since,
        "year the current auditor was first appointed, from the circular", filing("circular-2026.pdf"));
  }
  if (found("auditor_change")) {
    const start = q === Q3 ? "2024-05-31" : "2024-08-31";
    const changed = c.change && c.change.date > start && c.change.date <= q.asOf;
    put("auditor_change",
        changed ? { changed: true, date: c.change.date, previous_auditor: c.change.from }
                : { changed: false, date: null, previous_auditor: null },
        changed ? "change of auditor reporting package (NI 51-102 s.4.11)" : "auditor reappointed at the last two annual meetings",
        changed ? filing(`change-of-auditor-${c.change.date.slice(0, 7)}.pdf`) : filing("circular-2026.pdf"));
  }
  if (found("sec_registrant")) {
    put("sec_registrant", c.sec, c.sec.registrant ? "EDGAR filer record" : "no EDGAR filer under this name",
        c.sec.registrant ? `https://example.invalid/edgar/${c.sec.cik}` : `https://example.invalid/edgar/search/${c.slug}`);
  }
  if (found("reporting_currency")) put("reporting_currency", c.currency, "presentation currency of the financial statements", filing("financial-statements-2025.pdf"));
  for (const field of ["total_revenue", "net_income", "total_assets"]) {
    if (found(field)) put(field, c.financials[field], "audited consolidated financial statements, FY2025", filing("financial-statements-2025.pdf"));
  }
  return out;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function buildQuarter(db, q, actors) {
  const payload = payloadFor(q);
  const committed = await commitPeriod(db, payload, {
    label: q.label, sourceSha256: sha256(JSON.stringify(payload)), actorId: actors.analyst,
  });
  const ids = new Map((await db.all("select id, name_normalized from companies"))
    .map((r) => [r.name_normalized, r.id]));

  // One transaction: thousands of decisions, each its own fsync otherwise.
  let decisions = 0;
  await db.tx(async (db) => {
    for (const c of companies.filter((x) => (q === Q3 ? x.inQ3 : x.inQ4))) {
      for (const d of research(c, q)) {
        await recordDecision(db, {
          periodId: committed.periodId, companyId: ids.get(normName(c.name)), fieldKey: d.fieldKey,
          decision: "override", overrideValue: d.value, reason: d.reason, actorId: actors.analyst,
        });
        decisions++;
      }
    }
  });

  const gate = await evaluateGate(db, committed.periodId);
  let published;
  try {
    published = await publishPeriod(db, committed.periodId, { actorId: actors.admin });
  } catch (err) {
    if (!(err instanceof PublishBlocked)) throw err;
    published = await publishPeriod(db, committed.periodId, { actorId: actors.admin, overrideReason: OVERRIDE_REASON });
  }
  return { q, periodId: committed.periodId, decisions, gate, published };
}

/* ------------------------------------------------------------- build it */

if (existsSync(dbPath)) {
  let ours = false;
  try {
    const old = new DatabaseSync(dbPath, { readOnly: true });
    ours = Boolean(old.prepare("select 1 as yes from audit_log where event = ? limit 1").get(MARK));
    old.close();
  } catch { ours = false; }
  if (!ours) {
    console.error(`${dbPath} exists and was not built by this script, so it is left alone. ` +
                  "Delete it yourself, or name another path.");
    process.exit(1);
  }
  for (const f of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) if (existsSync(f)) unlinkSync(f);
}

const t0 = performance.now();
const handle = new DatabaseSync(dbPath);
applySchema(handle);
const db = new SqliteSql(handle);
await db.run("insert into audit_log (event, detail) values (?, ?)", MARK,
             JSON.stringify({ seed: SEED, script: "scripts/seed_showcase.mjs", synthetic: true }));

const insertUser = "insert into app_users (email, role) values (?, ?)";
for (const [email, role] of USERS) await db.run(insertUser, email, role);
const userId = async (email) => (await db.get("select id from app_users where email = ?", email)).id;
const actors = { analyst: await userId("analyst@example.invalid"), admin: await userId("admin@example.invalid") };

const q3 = await buildQuarter(db, Q3, actors);
// The Admin lowers the line before the next period is committed: commit
// copies the default onto the period it creates.
const changed = await putSettings(db, { default_threshold_amount: String(Q4.threshold) }, actors.admin);
for (const ch of changed) {
  await db.run("insert into audit_log (event, actor_id, detail) values ('setting_changed', ?, ?)",
               actors.admin, JSON.stringify(ch));
}
const q4 = await buildQuarter(db, Q4, actors);

/* ------------------------------------------------------------ summary */

const pct = (n, of) => `${of === 0 ? 0 : Math.round((1000 * n) / of) / 10}%`;
const billions = (n) => `C$${Math.round(n / B).toLocaleString("en-CA")}B`;
const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };

async function published(built) {
  const pub = await db.get(`select id, revision, override_reason from period_publications
      where period_id = ? order by revision desc limit 1`, built.periodId);
  const tiers = await db.all(`select company_id, tier, status, footprint from published_period_tiers
      where publication_id = ?`, pub.id);
  const values = new Map();
  for (const r of await db.all(`select company_id, field_key, value from published_period_values
      where publication_id = ? and field_key in ('market_cap_cad', 'auditor', 'exchange', 'commodities')`, pub.id)) {
    if (!values.has(r.company_id)) values.set(r.company_id, {});
    values.get(r.company_id)[r.field_key] = parse(r.value);
  }
  const aggregates = {};
  for (const a of await db.all(`select kind, bucket, sub_bucket, n from publication_aggregates
      where publication_id = ?`, pub.id)) {
    (aggregates[a.kind] ??= []).push({ bucket: a.bucket, sub: a.sub_bucket, n: Number(a.n) });
  }
  return { pub, tiers, rows: [...values.values()], aggregates };
}

const p3 = await published(q3);
const p4 = await published(q4);
const total = (s) => s.rows.reduce((a, r) => a + (r.market_cap_cad ?? 0), 0);
const count = (list, f) => list.filter(f).length;
const continuingCap3 = continuing.reduce((a, c) => a + c.cap3, 0);
const continuingCap4 = continuing.reduce((a, c) => a + c.cap4, 0);

console.log(`\nSYNTHETIC showcase database: ${dbPath}  (seed ${SEED}, ${((performance.now() - t0) / 1000).toFixed(1)}s)\n`);
for (const [q, s] of [[Q3, p3], [Q4, p4]]) {
  console.log(`  ${q.label}  C$${q.threshold / M}M line  ${s.tiers.length} companies  ` +
              `TSX ${count(s.rows, (r) => r.exchange === "TSX")} / TSXV ${count(s.rows, (r) => r.exchange === "TSXV")}  ` +
              `${billions(total(s))} in all`);
}
console.log(`    Q4 against Q3: ${continuing.length} in both (their market cap ` +
            `${continuingCap4 >= continuingCap3 ? "+" : ""}${pct(continuingCap4 - continuingCap3, continuingCap3)}), ` +
            `${newcomers.length} entrants (${count(newcomers, (c) => c.cap4 < 200 * M)} at C$100-200M), ` +
            `${inQ3.length - continuing.length} drop-outs`);

const TIER_ROWS = ["1", "2", "3", "4", "5", "6", "unclassified_no_stage_evidence",
                   "unclassified_no_property_evidence", "unclassified_conflicting"];
const tierOf = (s, b) => (s.aggregates.tier_distribution ?? []).find((t) => t.bucket === b)?.n ?? 0;
console.log("\n  tier                                 Q3     Q4");
for (const b of TIER_ROWS) {
  if (tierOf(p3, b) + tierOf(p4, b) === 0) continue;
  const label = /^\d$/.test(b) ? `Tier ${b}` : b.replace(/_/g, " ");
  console.log(`    ${label.padEnd(33)}${String(tierOf(p3, b)).padStart(4)}   ${String(tierOf(p4, b)).padStart(4)}`);
}
const FOOTPRINT_WORD = { abroad: "abroad only", canada_only: "Canada only", canada_and_abroad: "both", none: "none" };
for (const [q, s] of [[Q3, p3], [Q4, p4]]) {
  console.log(`  footprint ${q.key.toUpperCase()}: ` + ["abroad", "canada_only", "canada_and_abroad", "none"]
    .map((f) => { const n = count(s.tiers, (t) => t.footprint === f); return `${FOOTPRINT_WORD[f]} ${n} (${pct(n, s.tiers.length)})`; })
    .join(" · "));
}

for (const [q, s] of [[Q3, p3], [Q4, p4]]) {
  const firms = new Map();
  for (const r of s.rows) {
    const firm = r.auditor ?? "unknown";
    const f = firms.get(firm) ?? { n: 0, cap: 0 };
    f.n++; f.cap += r.market_cap_cad ?? 0;
    firms.set(firm, f);
  }
  const all = total(s);
  // Ties broken by name, so two runs print the same lines.
  const ranked = [...firms].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  const d = firms.get("Deloitte") ?? { n: 0, cap: 0 };
  console.log(`\n  auditor ${q.key.toUpperCase()}: Deloitte ${d.n} of ${s.rows.length} (${pct(d.n, s.rows.length)}) ` +
              `by count, ${billions(d.cap)} of ${billions(all)} (${pct(d.cap, all)}) by market cap`);
  console.log("    by count: " + ranked.slice(0, 11).map(([f, v]) => `${f} ${pct(v.n, s.rows.length)}`).join(" · "));
  console.log("    by cap:   " + [...firms].sort((a, b) => b[1].cap - a[1].cap).slice(0, 6)
    .map(([f, v]) => `${f} ${pct(v.cap, all)}`).join(" · "));
}
const commodityShare = new Map();
for (const r of p4.rows) for (const k of r.commodities ?? []) commodityShare.set(k, (commodityShare.get(k) ?? 0) + 1);
console.log("\n  commodities Q4: " + [...commodityShare].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
  .map(([k, n]) => `${k} ${pct(n, p4.rows.length)}`).join(" · "));

const migration = tierMigration(p4.aggregates, true);
console.log("\n  publications:");
for (const built of [q3, q4]) {
  const r = built.published;
  console.log(`    ${built.q.label} revision ${r.revision}: ${r.companies} companies, ${r.values.toLocaleString("en-CA")} values ` +
              `(${r.cited.toLocaleString("en-CA")} cited), ${r.aggregates} aggregates, ` +
              `${built.decisions.toLocaleString("en-CA")} overrides recorded; ` +
              (r.overridden ? `published THROUGH A BLOCKED GATE: ${built.gate.blockers.map((b) => b.detail).join("; ")}`
                            : "gate open"));
}
if (migration.kind === "matrix") {
  // The matrix reads a company Q3 never tiered -- a newcomer, or one research
  // had not reached -- as "research completed", not as a move.
  const moves = (direction) => migration.cells.filter((c) => c.direction === direction).reduce((a, c) => a + c.n, 0);
  console.log(`    Q4 migration against Q3: ${moves("up")} up a tier, ${moves("down")} down, ` +
              `${migration.researchCompleted} tiered for the first time (newcomers included)`);
}
console.log("\n  sign in at /api/dev/signin as viewer@, analyst@ or admin@example.invalid");
await db.close();
