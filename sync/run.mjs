// Scrapes each bank of the config (SYNC_CONFIG, else sync/config.json), posts its rows to the Hucha API and records the
// run there; each scraper's trail goes to stderr.
// Flags: --dry-run (count rows, post and record nothing), --bank <id> (only that bank), --from <file> (a saved
// ScrapeResult).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { getBank } from "../dist/index.js";
import { rowsFor } from "./rows.mjs";

loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const flagValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const onlyBank = flagValue("--bank");
const savedResultPath = flagValue("--from");

const { apiUrl, key, banks } = JSON.parse(
  process.env.SYNC_CONFIG ?? (await readFile(new URL("./config.json", import.meta.url), "utf8")),
);
const runDate = new Date().toLocaleDateString("sv-SE");
const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

const scrapes = savedResultPath
  ? [async () => JSON.parse(await readFile(savedResultPath, "utf8"))]
  : banks.filter(({ bank }) => onlyBank === undefined || bank === onlyBank).map(({ bank }) => () => scrape(bank));

let hasFailed = false;
for (const scrapeNext of scrapes) {
  const startedAt = new Date().toISOString();
  const result = await scrapeNext();
  if (result.debug) console.error(result.debug);
  const bankConfig = banks.find(({ bank }) => bank === result.bank);
  if (!bankConfig) {
    console.error(`${result.bank}: no está en el config`);
    hasFailed = true;
    continue;
  }
  if (!result.success) {
    console.error(`${result.bank}: ${result.error}`);
    hasFailed = true;
    await recordRun(bankConfig, startedAt, result.error, new Map());
    continue;
  }
  const { accountRows, warnings } = rowsFor(result, bankConfig, runDate);
  const figures = new Map();
  const errors = [];
  for (const { accountId, label, rows } of accountRows) {
    const prefix = `${result.bank} · ${label} → cuenta ${accountId}`;
    if (isDryRun) {
      console.log(`${prefix}: ${rows.length} filas`);
      continue;
    }
    const response = await fetch(`${apiUrl}/accounts/${accountId}/rows/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ rows }),
    });
    if (!response.ok) {
      errors.push(`${prefix}: HTTP ${response.status} ${await response.text()}`);
      continue;
    }
    const { created, known } = await response.json();
    figures.set(accountId, { created, known });
    console.log(`${prefix}: ${created} nuevas, ${known} conocidas`);
  }
  for (const warning of warnings) console.warn(warning);
  for (const error of errors) console.error(error);
  if (errors.length > 0) hasFailed = true;
  await recordRun(bankConfig, startedAt, errors.join("\n"), figures);
}
if (hasFailed) process.exitCode = 1;

async function scrape(bankId) {
  const bank = getBank(bankId);
  if (!bank) return { success: false, bank: bankId, error: "banco desconocido" };
  const prefix = bankId.toUpperCase();
  return bank.scrape({
    rut: process.env[`${prefix}_RUT`],
    password: process.env[`${prefix}_PASS`],
  });
}

// Records the run in the API with every account of the bank's config: the figures of the ones the run posted to, null
// for the rest. Nothing on a dry run.
async function recordRun(bankConfig, startedAt, error, figures) {
  if (isDryRun) return;
  const accountIds = new Set([...Object.values(bankConfig.accounts), ...Object.values(bankConfig.creditCards)]);
  const accounts = [...accountIds].map((id) => ({ account_id: id, ...(figures.get(id) ?? { created: null, known: null }) }));
  const response = await fetch(`${apiUrl}/sync-runs/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      bank: bankConfig.bank,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      error,
      accounts,
    }),
  });
  if (!response.ok) {
    console.error(`${bankConfig.bank}: la corrida no se registró: HTTP ${response.status} ${await response.text()}`);
    hasFailed = true;
  }
}
