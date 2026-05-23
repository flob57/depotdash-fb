## Goal

Run a scheduled job every night at **23:59** that pushes the day's data into Notion automatically, plus weekly / monthly / yearly distance rollups on the right dates. Also switch all "Duration (min)" outputs to a readable `Xh YYm` format.

## Key design decisions

1. **Storing target Notion databases per user.**
   Today, the database ID is typed into the export dialog each time and only the vehicles DB is saved in `localStorage`. A cron job has no browser, so we need to persist the destination databases server-side.

   New table `user_notion_settings` (1 row per user, RLS = owner only):
   - `shifts_db_id` (on-duty exports)
   - `sessions_db_id` (driving exports)
   - `daily_totals_db_id`
   - `distance_summary_db_id`
   - `notion_api_key` *(optional — see point 2)*
   - `timezone` (IANA, e.g. `Europe/Brussels`) so "today" / "Sunday" / "last day of month" match the user's local day

   A new **Settings** dialog (or extending the existing one) lets the user paste each database URL/ID once and pick their timezone.

2. **Notion auth for cron.**
   `NOTION_API_KEY` is currently a single project-level secret tied to the connector. That works as long as **all users share the same Notion workspace/integration**. If different users have their own Notion workspaces, this whole feature only works for the workspace owner — the others would need to paste their own integration token, which Notion's connector flow doesn't expose to us.

   **Question for you:** is this app used only by you (single Notion workspace), or do other users also connect their own Notion? I'll assume **single workspace (yours)** unless you say otherwise — that keeps it simple and uses the existing connector key.

3. **Schedule strategy — one cron, one route.**
   `pg_cron` runs in UTC. Rather than fighting timezones at the SQL layer, I'll schedule **one job every day at 23:00 UTC** that calls a single endpoint. The endpoint computes, **in each user's timezone**, whether "now" is close to 23:59 local; if not, it just exits. When it is:
   - Always export: today's on-duty sessions, today's driving sessions, today's daily totals.
   - If today is **Sunday** locally → also export `This week` distance.
   - If tomorrow is the **1st of next month** locally → also export `This month` distance.
   - If tomorrow is **Jan 1** locally → also export `This year` distance.

   (Running every UTC hour is also an option if you want sub-hour precision across many timezones. For a single-user app in one timezone, daily at 22:59 UTC for Europe/Brussels is fine.)

4. **Endpoint location.**
   New public route `src/routes/api/public/cron/nightly-export.ts`. Protected by the standard pg_cron `apikey` header (Supabase anon key) — no extra secret needed.

5. **Duration format change (`Xh YYm`).**
   Notion's `number` property can't display `7h30`. Two options:
   - **(A) Switch the property type to `rich_text`** in the target databases and write `"7h30"` strings. *Recommended* — matches what you asked for visually.
   - **(B) Keep `number` and write decimal hours (7.5)**. Less readable.

   I'll implement (A): the export code will look for the duration column as `rich_text` first; if it only finds the old `number` column it falls back to minutes (so nothing breaks until you update the Notion schema). You'll need to **change the "Duration (min)" columns in your three Notion databases to text** for the new format to show up.

6. **Server-side export refactor.**
   The current `exportSessionsToNotion` / `exportShiftsToNotion` / `exportDailyTotalsToNotion` server functions are user-scoped via `requireSupabaseAuth`. I'll extract their core logic into plain helpers (`src/lib/notion.server.ts`) that take `(userId, supabaseAdmin, databaseId, range)` and reuse them from both the existing UI server functions and the new cron route.

## Files to change / add

```text
supabase migration         user_notion_settings table + RLS + updated_at trigger
src/lib/notion.server.ts   shared export helpers (run per user, server-only)
src/lib/notion.functions.ts
                           - refactor to call shared helpers
                           - rich_text duration support (Xh YYm)
src/routes/api/public/cron/nightly-export.ts
                           cron endpoint
src/components/NotionSettingsDialog.tsx
                           UI to save the 4 DB IDs + timezone
src/components/ActionPanel.tsx
                           open the new settings dialog from the gear menu
pg_cron job                daily at 22:59 UTC → POST /api/public/cron/nightly-export
```

## Open questions before I build

1. **Multi-user Notion?** Single workspace (yours), or do you want each user to save their own Notion integration token?
2. **Timezone** — confirm `Europe/Brussels`? (I'll default to that.)
3. **Duration format option A (text "7h30") vs B (decimal hours)?** I recommend A.
4. **Distance summary**: export to the **same** daily-totals database, or a **separate** "Distance summary" database? (Different schemas — totals has Date/On duty/Driving/%, distance has Period/Total km.) I'd recommend a separate database; let me know if you already have one.

Once you confirm these four points I'll implement everything in one pass.