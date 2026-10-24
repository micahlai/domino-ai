# Scenarios we want to demo

Anyone can add an idea. The engine owner turns good ones into fixtures or sim events.

| Event | Good or bad | Change(s) | Status |
| --- | --- | --- | --- |
| Acme pays 45 days late | Bad | `delay_invoice` | In fixtures |
| Northwind does not renew | Bad | `lose_invoice` | In fixtures |
| Cloud bill jumps 30% | Bad | `remove_cash` | In fixtures |
| Brightpath goes out of business | Bad | `lose_invoice` | In fixtures |
| Cobalt expansion closes early | Good | `add_cash` | In fixtures |
| Bank lowers the credit line | Bad | new constraint limit | Idea (judge demo) |
| Cloud provider raises prices or cuts committed-use discounts | Bad | `remove_cash` on cloud bills | Idea (real hyperscaler-style event) |
| Hiring plan speeds up by 5 people | Bad | `remove_cash` per payroll | Idea |
| Big customer asks to move to monthly billing | Bad | split invoice | Idea (needs new Change kind) |
