import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ListTodo } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { getWeeklyTasksForToday, completeWeeklyTask } from "@/lib/weekly-tasks.functions";

type Task = { id: string; name: string };

export function WeeklyTasksCard() {
  const fetchTasks = useServerFn(getWeeklyTasksForToday);
  const completeTask = useServerFn(completeWeeklyTask);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [configured, setConfigured] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    fetchTasks()
      .then((r) => {
        if (cancelled) return;
        setConfigured(r.configured);
        setError(r.error);
        setTasks(r.tasks);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load weekly tasks");
        setTasks([]);
      });
    return () => { cancelled = true; };
  }, [fetchTasks]);

  

  const onCheck = async (t: Task) => {
    setPending((p) => ({ ...p, [t.id]: true }));
    try {
      await completeTask({ data: { pageId: t.id } });
      setTasks((cur) => (cur ?? []).filter((x) => x.id !== t.id));
      toast.success(`Tâche "${t.name}" terminée`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la mise à jour Notion");
    } finally {
      setPending((p) => {
        const { [t.id]: _, ...rest } = p;
        return rest;
      });
    }
  };

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tâches du jour
        </h2>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : tasks === null ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : tasks.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          Aucune tâche restante pour aujourd'hui.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <Checkbox
                id={`wt-${t.id}`}
                checked={false}
                disabled={pending[t.id]}
                onCheckedChange={(v) => { if (v) void onCheck(t); }}
              />
              <label
                htmlFor={`wt-${t.id}`}
                className="cursor-pointer text-sm leading-snug"
              >
                {t.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
