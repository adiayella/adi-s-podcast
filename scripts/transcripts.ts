import "./env";
import { fetchPendingTranscripts } from "@/transcripts/fetch";

// usage: npm run transcripts [-- --limit 25]   (downloads transcripts that feeds publish; applies the rights gate)
const i = process.argv.indexOf("--limit");
const limit = i >= 0 ? Number(process.argv[i + 1]) || 25 : 25;
fetchPendingTranscripts({ limit }).then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
