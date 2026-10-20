// Fills a LOCAL database with a demo user and a large, realistic set of checklists, so the dashboard
// and sidebar can be tried with hundreds of rows. Refuses to run against anything but localhost.
//
//   bun run seed                  # user "demo", password "demo-password"
//   bun run seed -- --count 400   # more checklists
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("seed-demo only runs against a local database");
}
const countArg = process.argv.indexOf("--count");
const COUNT = countArg > -1 ? Math.max(1, Number(process.argv[countArg + 1]) || 150) : 150;

const sql = postgres(url, { ssl: false, max: 4, onnotice: () => {} });

// Small seeded random generator so runs look the same
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const GROUPS = [
  ["Thesis", "Chapters, reading and submission steps"],
  ["Cloud course", "Workshop sessions and labs"],
  ["Home", "Chores, repairs and shopping"],
  ["Trips", "Packing lists and bookings"],
  ["Side projects", ""],
  ["Work", "Sprints and launch checklists"],
  ["Study group", "Weekly tasks for the group"],
  ["Events", "Things to prepare before the day"],
];
const TOPICS = ["Sprint", "Launch", "Packing", "Reading list", "Weekly review", "Deploy", "Shopping", "Lab", "Exam prep", "Budget", "Onboarding", "Retro", "Release", "Cleanup", "Checklist for"];
const TASKS = ["Draft outline", "Email the team", "Book tickets", "Review notes", "Update the README", "Back up files", "Pay the invoice", "Write tests", "Order supplies", "Call the landlord", "Prepare slides", "Fix the build", "Check the logs", "Ask for feedback", "Plan next week"];

const username = "demo";
const password = await Bun.password.hash("demo-password", { algorithm: "bcrypt", cost: 10 });
const [user] = await sql`
  INSERT INTO users (username, password_hash) VALUES (${username}, ${password})
  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
  RETURNING id
`;

await sql`DELETE FROM projects WHERE owner_id = ${user.id}`;
await sql`DELETE FROM project_groups WHERE owner_id = ${user.id}`;

const groups = await sql`
  INSERT INTO project_groups ${sql(GROUPS.map(([name, description], i) => ({ owner_id: user.id, name, description: description || null, position: i })), "owner_id", "name", "description", "position")}
  RETURNING id
`;

const day = 24 * 3600 * 1000;
const rows = Array.from({ length: COUNT }, (_, i) => {
  const topic = pick(TOPICS);
  const grouped = rnd() < 0.78;
  const created = new Date(Date.now() - between(1, 120) * day);
  return {
    owner_id: user.id,
    name: `${topic} ${between(1, 60)}${rnd() < 0.2 ? " (copy)" : ""}`,
    slug: `demo${String(i).padStart(4, "0")}${Math.random().toString(36).slice(2, 8)}`,
    visibility: rnd() < 0.2 ? "public" : "private",
    group_id: grouped ? pick(groups).id : null,
    pinned_at: i < 3 ? new Date() : null,
    archived_at: i >= COUNT - 6 ? new Date() : null,
    created_at: created,
    last_activity_at: new Date(Date.now() - between(0, 60) * day - between(0, 20) * 3600 * 1000),
  };
});
const projects = await sql`
  INSERT INTO projects ${sql(rows, "owner_id", "name", "slug", "visibility", "group_id", "pinned_at", "archived_at", "created_at", "last_activity_at")}
  RETURNING id
`;

const items: any[] = [];
for (const p of projects) {
  const n = between(3, 28);
  let order = 0;
  for (let i = 0; i < n; i++) {
    const section = i === 0 || (rnd() < 0.12 && i < n - 2);
    items.push({ project_id: p.id, title: section ? `Part ${order + 1}` : pick(TASKS), item_type: section ? "section" : "task", display_order: order++ });
  }
}
const inserted: { id: string; item_type: string }[] = [];
for (let i = 0; i < items.length; i += 500) {
  const chunk = items.slice(i, i + 500);
  inserted.push(...(await sql`INSERT INTO checklist_items ${sql(chunk, "project_id", "title", "item_type", "display_order")} RETURNING id, item_type`));
}
// Each checklist gets its own completion rate
const completions = inserted
  .filter((it) => it.item_type === "task" && rnd() < 0.45)
  .map((it) => ({ item_id: it.id, done_by_name: pick(["demo", "Rina", "Dimas", "Sam"]) }));
for (let i = 0; i < completions.length; i += 500) {
  await sql`INSERT INTO item_completions ${sql(completions.slice(i, i + 500), "item_id", "done_by_name")}`;
}

console.log(`Seeded user "${username}" (password "demo-password"): ${groups.length} projects, ${projects.length} checklists, ${inserted.length} items, ${completions.length} completions.`);
await sql.end();
