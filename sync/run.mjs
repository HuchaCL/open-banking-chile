// Scrapes each bank of sync/config.json and posts its rows to the Hucha API.
// Flags: --dry-run (count rows, post nothing), --bank <id> (only that bank), --from <file> (a saved ScrapeResult).
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

const { apiUrl, key, banks } = JSON.parse(await readFile(new URL("./config.json", import.meta.url), "utf8"));
const runDate = new Date().toLocaleDateString("sv-SE");

const scrapes = savedResultPath
  ? [async () => JSON.parse(await readFile(savedResultPath, "utf8"))]
  : banks.filter(({ bank }) => onlyBank === undefined || bank === onlyBank).map(({ bank }) => () => scrape(bank));

let hasFailed = false;
for (const scrapeNext of scrapes) {
  const result = await scrapeNext();
  const bankConfig = banks.find(({ bank }) => bank === result.bank);
  if (!result.success) {
    console.error(`${result.bank}: ${result.error}`);
    hasFailed = true;
    continue;
  }
  if (!bankConfig) {
    console.error(`${result.bank}: no está en el config`);
    hasFailed = true;
    continue;
  }
  const { accountRows, warnings } = rowsFor(result, bankConfig, runDate);
  for (const { accountId, label, rows } of accountRows) {
    const prefix = `${result.bank} · ${label} → cuenta ${accountId}`;
    if (isDryRun) {
      console.log(`${prefix}: ${rows.length} filas`);
      continue;
    }
    const response = await fetch(`${apiUrl}/accounts/${accountId}/rows/`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    if (!response.ok) {
      console.error(`${prefix}: HTTP ${response.status} ${await response.text()}`);
      hasFailed = true;
      continue;
    }
    const { created, known } = await response.json();
    console.log(`${prefix}: ${created} nuevas, ${known} conocidas`);
  }
  for (const warning of warnings) console.warn(warning);
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
