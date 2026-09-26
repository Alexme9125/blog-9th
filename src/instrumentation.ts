/**
 * Next calls `register` once per server instance and in every runtime. Keep the Node-only worker
 * import inside the runtime branch so Edge bundles and build/test phases never create a timer.
 */
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.VITEST === undefined
  ) {
    const { startMailWorker } = await import("./lib/mail/worker");
    startMailWorker();
  }
}
