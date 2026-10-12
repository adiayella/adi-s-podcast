import "./env";
import { saveSnapshots } from "@/services/snapshots";

// usage: npm run snapshot
saveSnapshots()
  .then((r) => console.log("snapshot saved:", r))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
