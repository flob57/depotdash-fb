// French paid-leave (CP) accrual: 2.5 days per month, leave year = 1 May → 30 April.
// On 1 May: any unused N-1 expires; remaining N becomes new N-1; new N starts at 0.
// CP days taken deduct from N-1 first, then N.

export type LeaveBalance = { nMinus1: number; n: number };

export type StartingBalance = {
  date: string; // YYYY-MM-DD — the day these balances are accurate as of
  nMinus1: number;
  n: number;
};

function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Compute current CP balance from a starting balance, the list of CP days taken,
 * and today's date.
 *
 * - We walk day-by-day from the day AFTER `start.date` up to and including `today`.
 * - On the 1st of every month: credit 2.5 days to N.
 * - On 1 May: rollover (expire old N-1, promote N → N-1, reset N to 0). The 1 May
 *   accrual happens AFTER rollover.
 * - On a day that appears in `cpDays`: deduct 1 from N-1 first, then N.
 */
export function computeLeaveBalance(
  start: StartingBalance,
  cpDays: string[],
  today: Date,
): LeaveBalance {
  let nMinus1 = Math.max(0, start.nMinus1);
  let n = Math.max(0, start.n);
  const cpSet = new Set(cpDays);

  const startDate = parseISO(start.date);
  const cur = new Date(startDate);
  cur.setDate(cur.getDate() + 1); // day after starting balance

  while (cur <= today) {
    const day = cur.getDate();
    const month = cur.getMonth() + 1; // 1..12

    if (day === 1) {
      // 1 May rollover happens before accrual
      if (month === 5) {
        nMinus1 = n; // remaining N rolls over (old N-1 expires)
        n = 0;
      }
      // Monthly accrual on the 1st
      n += 2.5;
    }

    if (cpSet.has(toISO(cur))) {
      let take = 1;
      const fromOld = Math.min(nMinus1, take);
      nMinus1 -= fromOld;
      take -= fromOld;
      if (take > 0) {
        const fromNew = Math.min(n, take);
        n -= fromNew;
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  return { nMinus1, n };
}
