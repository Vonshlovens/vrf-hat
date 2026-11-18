<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();

  const statusWord = { open: "open", requested: "drawing", drawn: "drawn" } as const;
  const statusTone = { open: "idle", requested: "run", drawn: "ok" } as const;
  const owners = $derived(data.members.filter((m) => m.role === "owner").length);
</script>

<svelte:head>
  <title>{data.org.name} | VRF Hat</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header class="page-head head">
    <div>
      <h1>{data.org.name}</h1>
      <p class="meta">You're {data.role === "member" ? "a member" : `an ${data.role}`}. Only members see these raffles.</p>
    </div>
    <a class="btn primary" href="/new?org={data.org.slug}">New raffle</a>
  </header>

  {#if form?.error}<p class="notice block" data-tone="fail" role="alert">{form.error}</p>{/if}

  <section class="block">
    <h2 class="h3 label">Raffles</h2>
    {#if data.raffles.length}
      <table class="table rows">
        <tbody>
          {#each data.raffles as r (r.slug)}
            <tr>
              <th scope="row"><a class="row-link" href="/r/{r.slug}">{r.title}</a></th>
              <td class="num w-min">{r.tickets}</td>
              <td class="w-min">
                <span class="status" data-tone={statusTone[r.status]}>
                  {r.status === "drawn" && r.recurring ? "finished" : statusWord[r.status]}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="meta">None yet.</p>
    {/if}
  </section>

  <section class="block">
    <h2 class="h3 label">Members</h2>
    <table class="table rows">
      <tbody>
        {#each data.members as m (m.id)}
          <tr>
            <th scope="row">
              {m.name}{#if m.me}<span class="meta"> (you)</span>{/if}
              {#if m.email}<span class="meta email">{m.email}</span>{/if}
            </th>
            <td class="w-min meta">{m.role}</td>
            <td class="w-min">
              {#if data.manager && !m.me && m.role !== "owner"}
                <form method="POST" action="?/remove" use:enhance>
                  <input type="hidden" name="id" value={m.id} />
                  <button class="btn ghost small">Remove</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  {#if data.manager}
    <section class="block narrow-col">
      <h2 class="h3 label">Invite someone</h2>
      <form method="POST" action="?/invite" use:enhance class="inline">
        <div class="field grow">
          <label for="email">Email</label>
          <input class="input" id="email" name="email" type="email" required value={form && "email" in form ? form.email : ""} />
        </div>
        <select class="select role" name="role" aria-label="Role">
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button class="btn primary">Send invite</button>
      </form>
      <p class="hint">
        They'll get a link, and accept by signing in with that address. Admins can invite and remove people.
      </p>
      {#if form?.invited}<p><span class="status" data-tone="ok">invited {form.invited}</span></p>{/if}

      {#if data.invitations.length}
        <h3 class="h3 label sub">Waiting to accept</h3>
        <table class="table rows">
          <tbody>
            {#each data.invitations as inv (inv.id)}
              <tr>
                <th scope="row">{inv.email}</th>
                <td class="w-min meta">{inv.role}</td>
                <td class="w-min">
                  <form method="POST" action="?/cancel" use:enhance>
                    <input type="hidden" name="id" value={inv.id} />
                    <button class="btn ghost small">Cancel</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}

  {#if !(data.role === "owner" && owners === 1)}
    <form method="POST" action="?/leave" class="block">
      <button
        class="btn ghost small"
        onclick={(e) => {
          if (!confirm(`Leave ${data.org.name}? You'll lose access to its raffles.`)) e.preventDefault();
        }}>Leave organization</button
      >
    </form>
  {/if}
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--s-2) var(--gutter);
  }
  .block {
    margin-top: calc(var(--lh) * 1.5);
  }
  .label {
    margin-bottom: var(--s-2);
  }
  .sub {
    margin-top: var(--lh);
  }
  .narrow-col {
    max-width: 60ch;
  }
  .email {
    display: block;
    font-weight: normal;
    overflow-wrap: anywhere;
  }
  .inline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) 1.5ch;
    align-items: flex-end;
  }
  .grow {
    flex: 1 1 24ch;
  }
  .role {
    width: auto;
  }
</style>
