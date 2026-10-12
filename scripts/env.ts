// Must be the first import in every script: loads .env.local before any module reads process.env.
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
