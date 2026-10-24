import type { Cents } from "@domino/contracts";

/** An exact fraction. Money math stays here until the single final rounding. */
export type Ratio = { num: bigint; den: bigint };

export const ratio = (num: bigint | number, den: bigint | number = 1n): Ratio => ({
  num: BigInt(num),
  den: BigInt(den),
});

export const addRatio = (a: Ratio, b: Ratio): Ratio => ({
  num: a.num * b.den + b.num * a.den,
  den: a.den * b.den,
});

/** Rounds to whole cents with Math.round semantics (half toward +infinity), exactly. */
export function roundCents(r: Ratio): Cents {
  if (r.den <= 0n) throw new Error("ratio denominator must be positive");
  const a = 2n * r.num + r.den;
  const b = 2n * r.den;
  const q = a / b;
  return Number(a % b !== 0n && a < 0n ? q - 1n : q);
}

/**
 * The decimal a person typed (64.4), not its binary float approximation.
 * JS prints the shortest decimal that round-trips, so String(x) recovers it.
 */
export function decimalRatio(x: number): Ratio {
  if (!Number.isFinite(x)) throw new Error(`not a finite number: ${x}`);
  const [mantissa = "0", exp = "0"] = String(x).split("e");
  const [int = "0", frac = ""] = mantissa.split(".");
  const scale = frac.length - Number(exp);
  const digits = BigInt(int + frac);
  return scale >= 0 ? ratio(digits, 10n ** BigInt(scale)) : ratio(digits * 10n ** BigInt(-scale));
}
