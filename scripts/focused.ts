import "./env";
import { runFocused } from "@/services/jobs";

// usage: npm run focused [-- --force]
runFocused({ force: process.argv.includes("--force") })
  .then((r) => {
    console.log(JSON.stringify(r, null, 1));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
