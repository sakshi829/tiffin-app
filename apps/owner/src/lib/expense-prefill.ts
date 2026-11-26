/**
 * Hand-over from "Quick add" to the expense form, inside the app only (F40).
 * It used to travel in the screen's link, so any other app could open
 * akowner://money/expense?amount=... and pre-fill the form. Now a link from
 * outside always opens an empty form; the values are taken once and cleared.
 */
export interface ExpensePrefill { amountPaise: number; categoryId: string | null; vendor: string | null; note: string }
let pending: ExpensePrefill | null = null;
export function setExpensePrefill(p: ExpensePrefill): void { pending = p; }
export function takeExpensePrefill(): ExpensePrefill | null { const p = pending; pending = null; return p; }
