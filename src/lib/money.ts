/** Normalise prices and line totals to cents before storing or comparing them. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function sameMoney(a: number, b: number): boolean {
  return roundMoney(a) === roundMoney(b);
}
