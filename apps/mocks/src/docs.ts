/**
 * Synthetic company documents served by /docs. Plain text only; ids are a fixed allowlist,
 * so no request can name a file path.
 */
export interface MockDocument {
  id: string;
  title: string;
  filename: string;
  text: string;
}

const BANNER = "SYNTHETIC DOCUMENT FOR THE DOMINO DEMO. NOT A REAL AGREEMENT.\n\n";

export const DOCUMENTS: MockDocument[] = [
  {
    id: "board-policy",
    title: "Board cash policy",
    filename: "board-policy.pdf",
    text: `${BANNER}Kestrel Board Cash Policy\n\n1. Purpose. This policy sets the minimum cash runway.\n\n2. Runway. Management shall keep at least 18 months of runway at the current net burn rate.\n`,
  },
  {
    id: "customer-contracts",
    title: "Customer contract summary",
    filename: "customer-contracts.pdf",
    text: `${BANNER}Customer Contract Summary\n\nAcme Logistics: annual renewal, net 30 payment terms.\nNorthwind Health: net 60 payment terms. Expansion order form not yet countersigned.\nBrightpath Retail: monthly billing, net 30.\nCobalt Labs: annual subscription, net 30.\n`,
  },
  {
    id: "loan-agreement",
    title: "Loan and security agreement",
    filename: "loan-agreement.pdf",
    text: `${BANNER}Loan and Security Agreement\n\nSection 7.1. Reporting. Borrower shall deliver monthly bank statements.\n\nSection 7.2. Minimum Cash. Borrower shall maintain Unrestricted Cash of not less than $3,000,000 at all times. "Unrestricted Cash" means cash in Borrower's deposit accounts, excluding any cash pledged as collateral, including the office lease collateral.\n`,
  },
  {
    id: "office-lease",
    title: "Office lease",
    filename: "office-lease.pdf",
    text: `${BANNER}Office Lease\n\nSection 4. Security. Tenant shall keep a letter of credit collateral deposit of $600,000 with the landlord's bank for the full lease term. Tenant may not use the collateral for operations.\n`,
  },
];
