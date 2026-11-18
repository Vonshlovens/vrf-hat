// Organizations and who can see a raffle. Membership itself (invites, roles,
// removal) is better-auth's organization plugin; this file only reads it.
import { error, redirect } from "@sveltejs/kit";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { db } from "./db/index.ts";
import { entry, member, organization, raffle, user, type Raffle } from "./db/schema.ts";
import { getRaffle } from "./raffles.ts";

export type OrgRole = "owner" | "admin" | "member";

/** Roles that can invite and remove people (better-auth's defaults). */
export const canManage = (role: OrgRole | null) => role === "owner" || role === "admin";

export async function memberRole(organizationId: string, userId: string | undefined) {
  if (!userId) return null;
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
  return (row?.role as OrgRole | undefined) ?? null;
}

export async function orgsOf(userId: string) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
}

export async function getOrg(slug: string) {
  const [row] = await db.select().from(organization).where(eq(organization.slug, slug));
  return row ?? null;
}

export async function orgName(organizationId: string) {
  const [row] = await db
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId));
  return row ?? null;
}

export async function membersOf(organizationId: string) {
  return db
    .select({
      id: member.id,
      role: member.role,
      userId: user.id,
      name: user.name,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, organizationId))
    .orderBy(asc(member.createdAt));
}

export async function rafflesOf(organizationId: string) {
  return db
    .select({ raffle, tickets: sql<number>`coalesce(sum(${entry.count}), 0)::int` })
    .from(raffle)
    .leftJoin(entry, eq(entry.raffleId, raffle.id))
    .where(eq(raffle.organizationId, organizationId))
    .groupBy(raffle.id)
    .orderBy(desc(raffle.createdAt));
}

/** The host always sees their raffle, even after leaving its organization. */
export async function canSee(r: Raffle, userId: string | undefined) {
  if (!r.organizationId) return true;
  if (userId && r.hostId === userId) return true;
  return (await memberRole(r.organizationId, userId)) !== null;
}

/**
 * The raffle at `slug` if this person may see it. A signed-out visitor to an
 * organization's raffle is sent to sign in; anyone else who can't see it gets
 * the same 404 as a raffle that doesn't exist. `api` routes never redirect.
 */
export async function visibleRaffle(
  slug: string,
  userId: string | undefined,
  opts: { next?: string } = {},
) {
  const r = await getRaffle(slug);
  if (r && (await canSee(r, userId))) return r;
  if (r && !userId && opts.next) redirect(303, `/login?next=${encodeURIComponent(opts.next)}`);
  error(404, "No raffle at this address.");
}

/** better-auth's message for a refused call, for showing in a form. */
export function authMessage(err: unknown): string | null {
  if (err instanceof APIError) return err.body?.message ?? err.message;
  return null;
}
