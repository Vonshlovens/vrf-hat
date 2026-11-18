import { error, fail, redirect } from "@sveltejs/kit";
import { auth } from "#lib/server/auth.ts";
import { text } from "#lib/server/form.ts";
import {
  authMessage,
  canManage,
  getOrg,
  memberRole,
  membersOf,
  rafflesOf,
} from "#lib/server/orgs.ts";
import type { Actions, PageServerLoad } from "./$types";

/** The organization if this person is in it; otherwise the same 404 as one that doesn't exist. */
async function myOrg(slug: string, userId: string | undefined) {
  if (!userId) redirect(303, `/login?next=/orgs/${slug}`);
  const org = await getOrg(slug);
  const role = org ? await memberRole(org.id, userId) : null;
  if (!org || !role) error(404, "No organization at this address.");
  return { org, role };
}

export const load: PageServerLoad = async ({ params, locals, request }) => {
  const { org, role } = await myOrg(params.slug, locals.user?.id);
  const manager = canManage(role);
  const [members, raffles, invitations] = await Promise.all([
    membersOf(org.id),
    rafflesOf(org.id),
    manager
      ? auth.api.listInvitations({ query: { organizationId: org.id }, headers: request.headers })
      : [],
  ]);
  return {
    org: { name: org.name, slug: org.slug },
    role,
    manager,
    // Members see each other's names; only owners and admins see emails.
    members: members.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name || "(no name)",
      email: manager ? m.email : null,
      me: m.userId === locals.user!.id,
    })),
    invitations: invitations
      .filter((i) => i.status === "pending" && new Date(i.expiresAt) > new Date())
      .map((i) => ({ id: i.id, email: i.email, role: i.role })),
    raffles: raffles.map(({ raffle, tickets }) => ({
      slug: raffle.slug,
      title: raffle.title,
      status: raffle.status,
      recurring: raffle.recurring,
      tickets,
    })),
  };
};

/** Runs a better-auth call; its refusals (e.g. "not allowed") come back as form errors. */
async function call(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const message = authMessage(err);
    if (message) return fail(400, { error: message });
    throw err;
  }
  return null;
}

export const actions: Actions = {
  invite: async ({ params, locals, request }) => {
    const { org } = await myOrg(params.slug, locals.user?.id);
    const form = await request.formData();
    const email = text(form, "email").trim().toLowerCase();
    const role = text(form, "role") === "admin" ? "admin" : "member";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(400, { email, error: "Enter a valid email address." });
    }
    try {
      await auth.api.createInvitation({
        body: { email, role, organizationId: org.id, resend: true },
        headers: request.headers,
      });
    } catch (err) {
      const message = authMessage(err);
      if (message) return fail(400, { email, error: message });
      throw err;
    }
    return { invited: email };
  },

  cancel: async ({ params, locals, request }) => {
    await myOrg(params.slug, locals.user?.id);
    const invitationId = text(await request.formData(), "id");
    return call(() =>
      auth.api.cancelInvitation({ body: { invitationId }, headers: request.headers }),
    );
  },

  remove: async ({ params, locals, request }) => {
    const { org } = await myOrg(params.slug, locals.user?.id);
    const memberIdOrEmail = text(await request.formData(), "id");
    return call(() =>
      auth.api.removeMember({
        body: { memberIdOrEmail, organizationId: org.id },
        headers: request.headers,
      }),
    );
  },

  leave: async ({ params, locals, request }) => {
    const { org } = await myOrg(params.slug, locals.user?.id);
    const refused = await call(() =>
      auth.api.leaveOrganization({ body: { organizationId: org.id }, headers: request.headers }),
    );
    if (refused) return refused;
    redirect(303, "/orgs");
  },
};
