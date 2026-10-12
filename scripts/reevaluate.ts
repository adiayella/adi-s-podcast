import "./env";
import { reevaluateAll } from "@/services/discovery";

// usage: npm run reevaluate   (re-scores discovery candidates from stored data; no network, no API quota)
reevaluateAll().then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
