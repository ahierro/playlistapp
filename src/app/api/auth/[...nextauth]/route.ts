import { handlers } from "@/auth";
import { withDevOrigin } from "@/lib/dev-origin";

// See `@/lib/dev-origin` for why the handlers are wrapped.
export const GET = withDevOrigin(handlers.GET);
export const POST = withDevOrigin(handlers.POST);
