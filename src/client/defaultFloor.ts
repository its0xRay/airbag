/** Choose an available floor, without changing a user's explicit selection. */
export function defaultFloor<T extends { strike: bigint }>(options: T[], reference?: bigint): T | undefined {
  const ordered = [...options].sort((a, b) => a.strike < b.strike ? -1 : a.strike > b.strike ? 1 : 0);
  return (reference ? ordered.filter(option => option.strike < reference).at(-1) : undefined) ?? ordered[0];
}
