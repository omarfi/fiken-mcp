import { findAccounts } from "./find-accounts.ts";
import { findContacts } from "./find-contacts.ts";
import { findInbox } from "./find-inbox.ts";
import { findInvoices } from "./find-invoices.ts";
import { findJournalEntries } from "./find-journal-entries.ts";
import { findProducts } from "./find-products.ts";
import { findPurchases } from "./find-purchases.ts";
import { findSales } from "./find-sales.ts";
import { getReport } from "./get-report.ts";
import { listCompanies } from "./list-companies.ts";
import type { ToolDefinition } from "./tool.ts";

export const TOOLS: readonly ToolDefinition[] = [
  listCompanies,
  findContacts,
  findProducts,
  findInvoices,
  findSales,
  findPurchases,
  findAccounts,
  findJournalEntries,
  findInbox,
  getReport,
];
