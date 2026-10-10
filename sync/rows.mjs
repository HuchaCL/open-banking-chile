const ACCOUNT_SOURCE = "account";

/**
 * Turns a ScrapeResult into the rows each Hucha account of the bank's config receives.
 *
 * @param {object} result ScrapeResult of src/types.ts.
 * @param {{bank: string, sources: string[], accounts: Record<string, number>, creditCards: Record<string, number>}} bankConfig
 *   `accounts` maps the index of a result account, as a string, to a Hucha account id; `creditCards` maps a card label.
 * @param {string} runDate YYYY-MM-DD, the date of a movement still "pendiente".
 * @returns {{accountRows: {accountId: number, label: string, rows: object[]}[], warnings: string[]}}
 *   `accountRows` has one entry per mapped account or card present in the result; `warnings` names every account or
 *   card present on one side only.
 */
export function rowsFor(result, bankConfig, runDate) {
  const { bank, sources } = bankConfig;
  const accounts = (result.accounts ?? []).map((account, index) => ({
    key: String(index),
    label: account.label ?? `cuenta ${index}`,
    // Santander also lists its card movements under the bank account.
    movements: account.movements.filter((movement) => movement.source === ACCOUNT_SOURCE),
  }));
  const cards = (result.creditCards ?? []).map((card) => ({
    key: card.label,
    label: card.label,
    movements: card.movements ?? [],
  }));
  const sides = [
    { mapping: bankConfig.accounts, found: accounts, missingLabel: (key) => `cuenta ${key}` },
    { mapping: bankConfig.creditCards, found: cards, missingLabel: (key) => key },
  ];

  const accountRows = [];
  const warnings = [];
  for (const { mapping, found, missingLabel } of sides) {
    for (const { key, label, movements } of found) {
      const accountId = mapping[key];
      if (accountId === undefined) {
        warnings.push(`${bank} · ${label}: no está en el config, se omite`);
        continue;
      }
      const rows = movements
        .filter((movement) => sources.includes(movement.source))
        .map((movement) => rowOf(movement, runDate));
      accountRows.push({ accountId, label, rows });
    }
    const foundKeys = new Set(found.map(({ key }) => key));
    for (const key of Object.keys(mapping).filter((key) => !foundKeys.has(key))) {
      warnings.push(`${bank} · ${missingLabel(key)}: está en el config y no vino en la corrida`);
    }
  }
  return { accountRows, warnings };
}

function rowOf(movement, runDate) {
  const [, installment, installments] = movement.installments?.match(/^(\d+)\/(\d+)$/) ?? [];
  return {
    date: movement.date === "pendiente" ? runDate : movement.date.split("-").reverse().join("-"),
    description: movement.description,
    amount: movement.amount,
    currency: movement.currency ?? "CLP",
    ...(Number(installments) > 1 && {
      installment: Number(installment),
      installments: Number(installments),
      total_amount: movement.totalAmount,
    }),
    raw: movement,
  };
}
