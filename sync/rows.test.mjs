import { describe, it, expect } from "vitest";
import { rowsFor } from "./rows.mjs";

const RUN_DATE = "2026-10-10";
const CARD = "Tarjeta Ejemplo ****0000";

function movement(overrides = {}) {
  return {
    date: "08-10-2026",
    description: "COMERCIO EJEMPLO",
    amount: -15990,
    balance: 0,
    source: "credit_card_unbilled",
    installments: "01/01",
    ...overrides,
  };
}

function bankConfig(overrides = {}) {
  return {
    bank: "ejemplo",
    sources: ["credit_card_unbilled", "credit_card_billed"],
    accounts: {},
    creditCards: { [CARD]: 5 },
    ...overrides,
  };
}

function cardResult(...movements) {
  return { success: true, bank: "ejemplo", creditCards: [{ label: CARD, movements }] };
}

describe("rowsFor", () => {
  it("sends a mapped card's movements to its Hucha account", () => {
    const charge = movement();
    const result = cardResult(charge);

    const sut = rowsFor(result, bankConfig(), RUN_DATE);

    expect(sut).toEqual({
      accountRows: [
        {
          accountId: 5,
          label: CARD,
          rows: [{ date: "2026-10-08", description: "COMERCIO EJEMPLO", amount: -15990, currency: "CLP", raw: charge }],
        },
      ],
      warnings: [],
    });
  });

  it("sends the movements of the bank account at index 0 to the account mapped to \"0\"", () => {
    const deposit = movement({ source: "account", amount: 200000 });
    const result = { success: true, bank: "ejemplo", accounts: [{ movements: [deposit] }] };
    const config = bankConfig({ sources: ["account"], accounts: { 0: 7 }, creditCards: {} });

    const sut = rowsFor(result, config, RUN_DATE);

    expect(sut.accountRows).toEqual([
      {
        accountId: 7,
        label: "cuenta 0",
        rows: [{ date: "2026-10-08", description: "COMERCIO EJEMPLO", amount: 200000, currency: "CLP", raw: deposit }],
      },
    ]);
  });

  it("leaves out account movements when the config lists only card sources", () => {
    const result = { success: true, bank: "ejemplo", accounts: [{ movements: [movement({ source: "account" })] }] };

    const sut = rowsFor(result, bankConfig({ accounts: { 0: 7 }, creditCards: {} }), RUN_DATE);

    expect(sut.accountRows).toEqual([{ accountId: 7, label: "cuenta 0", rows: [] }]);
  });

  it("sends card movements listed under the bank account only to the card", () => {
    const charge = movement({ card: "****0000" });
    const result = {
      success: true,
      bank: "ejemplo",
      accounts: [{ movements: [charge] }],
      creditCards: [{ label: CARD, movements: [charge] }],
    };

    const sut = rowsFor(result, bankConfig({ accounts: { 0: 7 } }), RUN_DATE);

    expect(sut.accountRows.map(({ accountId, rows }) => [accountId, rows.length])).toEqual([
      [7, 0],
      [5, 1],
    ]);
  });

  it("adds no installment fields to a purchase in one installment", () => {
    const result = cardResult(movement({ installments: "01/01", totalAmount: 15990 }));

    const sut = rowsFor(result, bankConfig(), RUN_DATE);

    expect(Object.keys(sut.accountRows[0].rows[0])).toEqual(["date", "description", "amount", "currency", "raw"]);
  });

  it("carries installment 2 of 6 and the whole purchase amount", () => {
    const result = cardResult(movement({ installments: "02/06", amount: -10000, totalAmount: 60000 }));

    const sut = rowsFor(result, bankConfig(), RUN_DATE);

    expect(sut.accountRows[0].rows[0]).toMatchObject({ installment: 2, installments: 6, total_amount: 60000 });
  });

  it("dates a purchase still pending with the run date", () => {
    const result = cardResult(movement({ date: "pendiente" }));

    const sut = rowsFor(result, bankConfig(), RUN_DATE);

    expect(sut.accountRows[0].rows[0].date).toBe("2026-10-10");
  });

  it("turns a dd-mm-yyyy date into yyyy-mm-dd", () => {
    const result = cardResult(movement({ date: "31-01-2026" }));

    const sut = rowsFor(result, bankConfig(), RUN_DATE);

    expect(sut.accountRows[0].rows[0].date).toBe("2026-01-31");
  });

  it("skips and reports a card absent from the config", () => {
    const result = {
      success: true,
      bank: "ejemplo",
      creditCards: [
        { label: CARD, movements: [movement()] },
        { label: "Tarjeta Nueva ****9999", movements: [movement()] },
      ],
    };

    const sut = rowsFor(result, bankConfig(), RUN_DATE);

    expect(sut.accountRows.map(({ accountId }) => accountId)).toEqual([5]);
    expect(sut.warnings).toEqual(["ejemplo · Tarjeta Nueva ****9999: no está en el config, se omite"]);
  });

  it("reports a config entry absent from the result", () => {
    const result = cardResult(movement());
    const config = bankConfig({ accounts: { 0: 7 }, creditCards: { [CARD]: 5, "Tarjeta Vieja ****1111": 6 } });

    const sut = rowsFor(result, config, RUN_DATE);

    expect(sut.warnings).toEqual([
      "ejemplo · cuenta 0: está en el config y no vino en la corrida",
      "ejemplo · Tarjeta Vieja ****1111: está en el config y no vino en la corrida",
    ]);
  });
});
