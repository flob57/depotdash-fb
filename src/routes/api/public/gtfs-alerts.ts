import { createFileRoute } from "@tanstack/react-router";

const FEED_URL =
  "https://notify.ratpdev.com/api/networks/RD%20QUIMPER/alerts/gtfsrt";

export const Route = createFileRoute("/api/public/gtfs-alerts")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const upstream = await fetch(FEED_URL, {
            headers: { Accept: "application/json" },
          });
          if (!upstream.ok) {
            return new Response(
              JSON.stringify({ error: `Upstream ${upstream.status}` }),
              {
                status: 502,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              },
            );
          }
          const body = await upstream.text();
          return new Response(body, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=60",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message }),
            {
              status: 502,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            },
          );
        }
      },
    },
  },
});
