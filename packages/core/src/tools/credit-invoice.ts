import * as z from "zod";
import { kronerSchema, kronerToOre } from "../money.ts";
import { salesVatInput } from "../vat.ts";
import { companyInput, compact, dateInput, fikenId, resolveCompany, ToolError } from "./common.ts";
import { creditNoteDetail } from "./summaries.ts";
import { CONFIRM_FIRST, defineTool, DESTRUCTIVE, jsonResult } from "./tool.ts";
import { accountInput, newId } from "./write-common.ts";

export const creditInvoice = defineTool({
  name: "credit_invoice",
  access: "write",
  title: "Krediter faktura",
  description:
    `Kreditnota for en faktura. Uten lines: hele fakturaen. Bokføres og kan ikke angres. ${CONFIRM_FIRST}`,
  inputSchema: z.object({
    company: companyInput,
    invoice_id: fikenId("Faktura-ID"),
    issue_date: dateInput("ÅÅÅÅ-MM-DD, standard i dag").optional(),
    text: z.string().optional(),
    lines: z
      .array(
        z.object({
          description: z.string().min(1),
          quantity: z.number().positive().default(1),
          unit_price: kronerSchema("Eks. MVA"),
          vat_type: salesVatInput.default("HIGH"),
          income_account: accountInput("Konto").default("3000"),
        }),
      )
      .min(1)
      .optional()
      .describe("For delvis kreditering"),
  }),
  annotations: DESTRUCTIVE,
  async handler(input, { fiken, today }) {
    const companySlug = await resolveCompany(fiken, input.company);
    const params = { path: { companySlug } };
    const issueDate = input.issue_date ?? today;

    const { data: invoice } = await fiken.api.GET("/companies/{companySlug}/invoices/{invoiceId}", {
      params: { path: { companySlug, invoiceId: input.invoice_id } },
    });
    if (!invoice) throw new ToolError(`Fant ikke faktura ${input.invoice_id}.`);

    const { response } = input.lines
      ? await fiken.api.POST("/companies/{companySlug}/creditNotes/partial", {
          params,
          body: {
            issueDate,
            invoiceId: input.invoice_id,
            ...compact({ creditNoteText: input.text }),
            lines: input.lines.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unitPrice: kronerToOre(line.unit_price),
              vatType: line.vat_type,
              incomeAccount: line.income_account,
            })),
          },
        })
      : await fiken.api.POST("/companies/{companySlug}/creditNotes/full", {
          params,
          body: { issueDate, invoiceId: input.invoice_id, ...compact({ creditNoteText: input.text }) },
        });

    const creditNoteId = newId(response, "at kreditnotaen ble laget");
    const { data } = await fiken.api.GET("/companies/{companySlug}/creditNotes/{creditNoteId}", {
      params: { path: { companySlug, creditNoteId: String(creditNoteId) } },
    });
    return jsonResult({ credited: true, creditNote: data ? creditNoteDetail(data) : { id: creditNoteId } });
  },
});
