import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema.ts";
import { DATABASE_URL } from "$app/env/private";

export const db = drizzle(neon(DATABASE_URL), { schema });
