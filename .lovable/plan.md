## Goal

Add a "Declared hours" tracking system with overtime counter, plus a French-style paid leave (CP) counter, and let days be marked as Public Holiday or Paid Leave.

## What you'll see in the app

**Top of dashboard — two new counter cards:**
- **Overtime balance** — green if ≥ 0, red if < 0. Computed as: sum(declared hours) − sum(due hours over the same days, excluding holidays/CP/weekends) + starting overtime balance.
- **Paid leave (CP)** — shows `N-1: X.X days` and `N: Y.Y days` with total remaining. Color-coded.

**New "Declared hours" card** (below ActionPanel):
- Date picker + hours input (e.g. `7.5` or `7:30`) + optional note → "Save".
- List of recent declarations with edit/delete.

**Public Holidays card → renamed "Day off"** with a type selector:
- `Public holiday` (existing behavior — no due hours, no deficit)
- `Paid leave (CP)` — same effect on due hours, plus deducts 1 day from CP counter (N-1 first, then N)

**Settings card "Starting balances"** (one-time setup):
- Manual input for current overtime balance (hours, can be negative) and starting CP balances (N-1 days, N days).
- Set once; future calculations build on top.

## Rules implemented

**Overtime:**
```
overtime = startingOvertimeMs
         + Σ(declaredMs per day)
         − Σ(dueMs per day where day is weekday AND not holiday AND not CP)
```
Days with no declaration but in the past still count as 0 declared (so a missed day creates negative overtime). Today and future days are excluded from "due" until declared, to avoid a constantly-growing deficit.

**Paid leave (CP) — French system:**
- Leave year N = 1 May → 30 April.
- On the 1st of each month, credit 2.5 days to year N (the currently-accruing year).
- A CP day taken: deduct from N-1 first, then N.
- On 1 May: any unused N-1 expires; remaining N rolls over → N becomes N-1, new N starts at 0.
- Starting balances seed both N-1 and N counters at the date the user enters them.

Implemented as a pure function `computeLeaveBalance(startingBalance, cpDaysTaken, today)` that:
1. Walks months from the starting-balance date to today.
2. On each "1st of month", adds 2.5 to N.
3. On each "1 May" rollover, expires old N-1 and promotes N → N-1.
4. Deducts CP days taken (N-1 first, then N) in date order.

## Technical details

**Database migration:**
- New table `declared_hours` — `id`, `user_id`, `work_date` (date, unique per user), `hours_minutes` (int, minutes), `note`. RLS scoped to `auth.uid()`.
- Extend `public_holidays` → add `kind` text column with check (`'holiday' | 'paid_leave'`), default `'holiday'`. Existing rows become `'holiday'`.
- New table `user_balance_settings` — `user_id` PK, `starting_overtime_minutes` int default 0, `starting_cp_n_minus_1` numeric default 0, `starting_cp_n` numeric default 0, `starting_balance_date` date (defaults to today on insert). RLS scoped to `auth.uid()`.

**Files to add:**
- `src/lib/declared.ts` — types + sum helpers.
- `src/lib/leave.ts` — `computeLeaveBalance()` pure function with full year-N/N-1 logic.
- `src/components/DeclaredHoursCard.tsx` — input + list.
- `src/components/OvertimeBanner.tsx` — top counter (overtime + CP).
- `src/components/StartingBalancesDialog.tsx` — settings dialog.

**Files to edit:**
- `src/hooks/useTrackingData.tsx` — load `declared_hours` + `user_balance_settings`; expose `declared`, `startingBalances`.
- `src/components/PublicHolidaysCard.tsx` — add kind toggle (`Public holiday` / `Paid leave`); rename header to "Days off".
- `src/lib/stats.ts` — `dueHoursMs()` already excludes holidays; extend to also exclude paid-leave days (treat both the same for "due" purposes).
- `src/routes/index.tsx` — render `OvertimeBanner` at top, add `DeclaredHoursCard`, pass `cpDays` to leave computation.

**Notion export:** out of scope for this turn (existing pipeline keeps working; declared hours stay local). Can be added later if you want.

## Out of scope (ask if you want them)
- Auto-syncing declared hours / CP to Notion.
- Half-day CP support (current spec: whole days).
- Editing per-day hours via a calendar view (current: date picker + list).