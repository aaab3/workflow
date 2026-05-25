/**
 * Terminal / CLI app discovery API.
 */

import type { FastifyInstance } from "fastify";
import { detectCliApps, CLI_APP_PRESETS } from "@openclaw/workflow-engine";

export async function terminalRoutes(app: FastifyInstance): Promise<void> {
  /** List presets with on-machine detection status */
  app.get("/api/terminal/apps", async (_req, reply) => {
    const apps = await detectCliApps();
    const detected = apps.filter((a) => a.detected);
    return reply.send({
      apps,
      detectedCount: detected.length,
      totalPresets: CLI_APP_PRESETS.length,
    });
  });
}
