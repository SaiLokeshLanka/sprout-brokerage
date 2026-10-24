-- The shared account that collects brokerage, taxes and fees on every trade.
INSERT INTO "ledger_accounts" ("id", "type", "userId", "balancePaise", "createdAt", "updatedAt")
VALUES ('system-charges', 'SYSTEM_CHARGES', NULL, 0, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
