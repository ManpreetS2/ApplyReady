import { getDb } from "../db/database.js";
import { startGuidedDemo } from "../services/demo/demo.js";

const db = getDb();
const result = await startGuidedDemo(db);
console.log(`Seeded guided demo application: ${result.application?.id}`);
console.log(
  `Initial readiness: ${result.analysis.report.status} (${result.analysis.report.score})`,
);
