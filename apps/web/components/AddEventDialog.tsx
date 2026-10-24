"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCents, formatDate } from "@/lib/format";
import type { RiskEvent } from "@domino/contracts";
import { Plus } from "lucide-react";
import { useState } from "react";
import {
  type EventDraft,
  type EventFields,
  type EventInputs,
  type EventTemplate,
  buildEventDraft,
} from "./flows/eventDraft";

const templates: { id: EventTemplate; label: string }[] = [
  { id: "late_payment", label: "Customer pays late" },
  { id: "lost_renewal", label: "Customer does not renew" },
  { id: "cloud_spike", label: "Cloud bill increases" },
  { id: "early_deal", label: "New deal closes early" },
  { id: "credit_limit", label: "Bank lowers the credit line" },
];
const control =
  "mt-2 min-h-11 w-full rounded-md border bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

export function AddEventDialog({
  risks,
  inputs,
  onAdd,
  unavailableReason,
}: {
  risks: RiskEvent[];
  inputs?: EventInputs;
  onAdd?: (event: EventDraft) => Promise<void>;
  unavailableReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState("");
  const [fields, setFields] = useState<EventFields>({
    template: "late_payment",
    target: "",
    days: "45",
    amount: "",
    date: inputs?.asOf ?? "",
  });
  const [review, setReview] = useState<EventDraft>();
  const change = (patch: Partial<EventFields>) => {
    setFields((current) => ({ ...current, ...patch }));
    setReview(undefined);
    setMessage("");
  };
  async function submit() {
    if (!onAdd || !review || pending || submitted) return;
    setPending(true);
    setMessage("");
    try {
      await onAdd(review);
      setSubmitted(true);
      setMessage("Event requested. Waiting for the updated forecast; no action has been executed.");
    } catch {
      setMessage("Could not request this event. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="mr-2 size-4" aria-hidden="true" />
          Add event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What could change?</DialogTitle>
          <DialogDescription>
            Choose an event and review its details before requesting a new cash forecast.
          </DialogDescription>
        </DialogHeader>
        {inputs ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                setReview(buildEventDraft(fields, inputs));
                setMessage("");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Check the event details.");
              }
            }}
          >
            <label className="block text-sm">
              Event
              <select
                className={control}
                value={fields.template}
                onChange={(event) =>
                  change({ template: event.target.value as EventTemplate, target: "" })
                }
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
            </label>
            {fields.template === "credit_limit" ? (
              <p className="text-sm text-muted-foreground">
                A lower credit line changes the lender’s requirements. This event is not available
                for simulation yet.
              </p>
            ) : (
              <>
                {fields.template === "late_payment" ? (
                  <>
                    <label className="block text-sm">
                      Unpaid invoice
                      <select
                        required
                        className={control}
                        value={fields.target}
                        onChange={(event) => change({ target: event.target.value })}
                      >
                        <option value="" disabled>
                          Choose an invoice
                        </option>
                        {inputs.invoices
                          .filter((invoice) => !invoice.paid)
                          .map((invoice) => (
                            <option key={invoice.id} value={invoice.id}>
                              {inputs.customers.find(
                                (customer) => customer.id === invoice.customerId,
                              )?.name ?? "Customer"}{" "}
                              · {formatCents(invoice.amount)} · due {formatDate(invoice.due)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="block text-sm">
                      Days late
                      <input
                        required
                        type="number"
                        min={1}
                        max={365}
                        step={1}
                        className={control}
                        value={fields.days}
                        onChange={(event) => change({ days: event.target.value })}
                      />
                    </label>
                  </>
                ) : null}
                {fields.template === "lost_renewal" ? (
                  <label className="block text-sm">
                    Customer
                    <select
                      required
                      className={control}
                      value={fields.target}
                      onChange={(event) => change({ target: event.target.value })}
                    >
                      <option value="" disabled>
                        Choose a customer
                      </option>
                      {inputs.customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {fields.template === "cloud_spike" || fields.template === "early_deal" ? (
                  <label className="block text-sm">
                    {fields.template === "cloud_spike" ? "Additional cloud cost" : "Cash received"}{" "}
                    (USD)
                    <input
                      required
                      inputMode="decimal"
                      placeholder="25000.00"
                      className={control}
                      value={fields.amount}
                      onChange={(event) => change({ amount: event.target.value })}
                    />
                  </label>
                ) : null}
                {fields.template !== "late_payment" ? (
                  <label className="block text-sm">
                    {fields.template === "lost_renewal" ? "Renewal stops from" : "Cash date"}
                    <input
                      required
                      type="date"
                      min={inputs.asOf}
                      className={control}
                      value={fields.date}
                      onChange={(event) => change({ date: event.target.value })}
                    />
                  </label>
                ) : null}
                <Button type="submit" variant="secondary" disabled={pending || submitted}>
                  Review event
                </Button>
              </>
            )}
          </form>
        ) : (
          <div className="space-y-2">
            {risks.map((risk) => (
              <Button
                key={risk.id}
                variant={selected === risk.id ? "secondary" : "outline"}
                className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                aria-pressed={selected === risk.id}
                onClick={() => {
                  setSelected(risk.id);
                  setReview({ label: risk.label, changes: risk.changes });
                  setMessage("");
                }}
              >
                {risk.label}
              </Button>
            ))}
          </div>
        )}
        {review ? (
          <div className="space-y-3 rounded-lg bg-muted p-4">
            <p className="text-sm font-medium">{review.label}</p>
            <p className="text-xs text-muted-foreground">
              {review.changes.length} proposed change{review.changes.length === 1 ? "" : "s"}. The
              cash impact will be computed when the event is added.
            </p>
            <Button disabled={!onAdd || pending || submitted} onClick={submit}>
              {pending ? "Requesting…" : submitted ? "Requested" : "Add to forecast"}
            </Button>
          </div>
        ) : null}
        {!onAdd ? (
          <p className="text-sm text-muted-foreground">
            {unavailableReason ?? "Sample preview only. Company records will not change."}
          </p>
        ) : null}
        {message ? (
          <output className="block text-sm" aria-live="polite">
            {message}
          </output>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
