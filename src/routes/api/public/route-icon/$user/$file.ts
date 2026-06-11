import { createFileRoute } from "@tanstack/react-router";

const UUID_RE = /^[0-9a-f-]{32,36}$/i;
const FILE_RE = /^[a-zA-Z0-9._-]{1,200}$/;

export const Route = createFileRoute("/api/public/route-icon/$user/$file")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { user, file } = params;
        if (!UUID_RE.test(user) || !FILE_RE.test(file)) {
          return new Response("Bad request", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.storage
          .from("route-icons")
          .download(`${user}/${file}`);
        if (error || !data) return new Response("Not found", { status: 404 });
        const buf = await data.arrayBuffer();
        const ext = file.split(".").pop()?.toLowerCase() ?? "";
        const contentType =
          data.type ||
          (ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "gif"
                ? "image/gif"
                : ext === "webp"
                  ? "image/webp"
                  : ext === "svg"
                    ? "image/svg+xml"
                    : "application/octet-stream");
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      },
    },
  },
});
