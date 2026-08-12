import { describe, expect, it } from "vitest";
import { createHarvestLedger, trustedTomatoWeight, updateHarvestLedger } from "./tomato-harvest.js";

const now = new Date("2026-08-12T12:00:00.000Z");
const record = {
  id: "record-1",
  date: "2026-08-12",
  tomatoStatus: "完美的🍅",
  tomatoWeight: 999,
  completionPercent: 100,
  taskGoal: "安全测试",
  completionContent: "完成",
  createdAt: "2026-08-12T11:59:00.000Z"
};

describe("trusted tomato harvest ledger", () => {
  it("derives weight from the server allowlist instead of client weight", () => {
    expect(trustedTomatoWeight(record)).toBe(1);
    expect(createHarvestLedger({ records: [record] }, now).records[0].tomatoWeight).toBe(1);
  });

  it("rejects direct record injection without an observed active timer", () => {
    const ledger = createHarvestLedger({ records: [] }, now);
    const updated = updateHarvestLedger(ledger, { records: [] }, { records: [record] }, now);
    expect(updated.records).toHaveLength(0);
  });

  it("accepts one submitted timer record and keeps its reward fields immutable", () => {
    const active = { id: "timer-1", phase: "focus" };
    const ledger = createHarvestLedger({ activePomodoro: active, records: [] }, now);
    const completedAt = new Date(now.getTime() + 25 * 60 * 1000);
    const accepted = updateHarvestLedger(
      ledger,
      { activePomodoro: active, records: [] },
      { activePomodoro: { ...active, submittedRecordId: "record-1" }, records: [{ ...record, createdAt: completedAt.toISOString() }] },
      completedAt
    );
    expect(accepted.records).toHaveLength(1);
    const edited = updateHarvestLedger(
      accepted,
      { activePomodoro: null, records: [record] },
      { activePomodoro: null, records: [{ ...record, tomatoWeight: 500, tomatoStatus: "半个🍅" }] },
      completedAt
    );
    expect(edited.records[0]).toMatchObject({ tomatoStatus: "完美的🍅", tomatoWeight: 1 });

    const duplicate = updateHarvestLedger(
      accepted,
      { activePomodoro: { ...active, submittedRecordId: "record-1" }, records: [record] },
      {
        activePomodoro: { ...active, submittedRecordId: "record-2" },
        records: [record, { ...record, id: "record-2", createdAt: completedAt.toISOString() }]
      },
      completedAt
    );
    expect(duplicate.records).toHaveLength(1);
  });

  it("caps reward weight by server-observed timer duration", () => {
    const active = { id: "timer-1", phase: "focus" };
    const ledger = createHarvestLedger({ activePomodoro: active, records: [] }, now);
    const fiveMinutesLater = new Date(now.getTime() + 5 * 60 * 1000);
    const accepted = updateHarvestLedger(
      ledger,
      { activePomodoro: active, records: [] },
      { activePomodoro: { ...active, submittedRecordId: "record-1" }, records: [{ ...record, createdAt: fiveMinutesLater.toISOString() }] },
      fiveMinutesLater
    );
    expect(accepted.records[0].tomatoWeight).toBe(0.2);
  });
});
