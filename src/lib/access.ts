import sql from "../db";

export async function getProject(slug: string) {
  const [project] = await sql<
    {
      id: string;
      owner_id: string;
      name: string;
      slug: string;
      visibility: "public" | "private";
      created_at: string;
      updated_at: string;
      group_id: string | null;
      archived_at: string | null;
      pinned_at: string | null;
      last_activity_at: string | null;
    }[]
  >`SELECT * FROM projects WHERE slug = ${slug}`;
  return project ?? null;
}

export function canAccess(
  project: { visibility: string; owner_id: string },
  userId: string | undefined
): boolean {
  return project.visibility === "public" || project.owner_id === userId;
}

export function isOwner(
  project: { owner_id: string },
  userId: string | undefined
): boolean {
  return !!userId && project.owner_id === userId;
}
