import {
  type Change,
  ChangeSchema,
  type Customer,
  ISODateSchema,
  type Invoice,
} from "@domino/contracts";

export interface EventInputs {
  asOf: string;
  customers: Customer[];
  invoices: Invoice[];
}
export type EventTemplate =
  | "late_payment"
  | "lost_renewal"
  | "cloud_spike"
  | "early_deal"
  | "credit_limit";
export interface EventDraft {
  label: string;
  changes: Change[];
}
export interface EventFields {
  template: EventTemplate;
  target: string;
  days: string;
  amount: string;
  date: string;
}

export function dollarsToCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw new Error("Enter a positive dollar amount with at most two decimal places.");
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Enter a positive amount within the supported range.");
  return Number(cents);
}

export function buildEventDraft(fields: EventFields, inputs: EventInputs): EventDraft {
  const parsed = ISODateSchema.safeParse(fields.date);
  const calendar = new Date(`${fields.date}T00:00:00Z`);
  if (
    !parsed.success ||
    Number.isNaN(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== fields.date
  )
    throw new Error("Choose a real calendar date.");
  if (fields.date < inputs.asOf)
    throw new Error("Choose a date on or after the current forecast date.");
  const customer = inputs.customers.find((item) => item.id === fields.target);
  const invoice = inputs.invoices.find((item) => item.id === fields.target && !item.paid);
  let result: EventDraft;
  switch (fields.template) {
    case "late_payment": {
      const days = Number(fields.days);
      if (!invoice) throw new Error("Choose an unpaid invoice from this company.");
      if (!/^\d+$/.test(fields.days) || !Number.isInteger(days) || days < 1 || days > 365)
        throw new Error("Enter 1 to 365 whole days.");
      result = {
        label: `${inputs.customers.find((item) => item.id === invoice.customerId)?.name ?? "Customer"} pays ${days} days late`,
        changes: [{ kind: "delay_invoice", invoiceId: invoice.id, days }],
      };
      break;
    }
    case "lost_renewal":
      if (!customer) throw new Error("Choose a customer from this company.");
      result = {
        label: `${customer.name} does not renew`,
        changes: [{ kind: "churn", customerId: customer.id, fromDate: fields.date }],
      };
      break;
    case "cloud_spike":
    case "early_deal": {
      const amount = dollarsToCents(fields.amount);
      const label =
        fields.template === "cloud_spike" ? "Cloud bill increases" : "New deal closes early";
      result = {
        label,
        changes: [
          {
            kind: fields.template === "cloud_spike" ? "remove_cash" : "add_cash",
            date: fields.date,
            amount,
            label,
          },
        ],
      };
      break;
    }
    case "credit_limit":
      throw new Error(
        "A lower credit line needs a change to the lender’s requirements. This event is not available yet.",
      );
  }
  return {
    label: result.label,
    changes: result.changes.map((change) => ChangeSchema.parse(change)),
  };
}
