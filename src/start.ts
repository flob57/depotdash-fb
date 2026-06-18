import { createStart, createMiddleware } from "@tanstack/react-start";

import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Log errors server-side without swallowing them — returning a raw Response
// from a requestMiddleware breaks the h3 pipeline ("Cannot read properties of
// undefined (reading 'method')"). The wrapper in src/server.ts converts any
// uncaught failure into the branded error page.
const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (!(error != null && typeof error === "object" && "statusCode" in error)) {
      console.error(error);
    }
    throw error;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));

