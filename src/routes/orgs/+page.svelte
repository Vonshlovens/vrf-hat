<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
</script>

<svelte:head><title>Organizations | VRF Hat</title></svelte:head>

<div class="page narrow">
  <header class="page-head">
    <h1>Organizations</h1>
    <p class="lede">An organization's raffles are visible only to its members: names, tickets and results.</p>
  </header>

  {#if data.invitations.length}
    <section class="block">
      <h2 class="h3 label">Invitations for you</h2>
      <ul class="list">
        {#each data.invitations as inv (inv.id)}
          <li><a href="/invite/{inv.id}">{inv.orgName}</a></li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if data.orgs.length}
    <section class="block">
      <h2 class="h3 label">Yours</h2>
      <table class="table rows">
        <tbody>
          {#each data.orgs as org (org.id)}
            <tr>
              <th scope="row"><a class="row-link" href="/orgs/{org.slug}">{org.name}</a></th>
              <td class="w-min meta">{org.role}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <section class="block">
    <h2 class="h3 label">New organization</h2>
    <form method="POST" action="?/create" use:enhance class="inline">
      <div class="field grow">
        <label for="name">Name</label>
        <input class="input" id="name" name="name" type="text" required maxlength="80" value={form?.name ?? ""} />
      </div>
      <button class="btn primary">Create</button>
    </form>
    {#if form?.error}<p class="field-error" role="alert">{form.error}</p>{/if}
  </section>
</div>

<style>
  .block {
    margin-top: calc(var(--lh) * 1.5);
  }
  .label {
    margin-bottom: var(--s-2);
  }
  .list {
    padding-left: 2ch;
  }
  .inline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2) 1.5ch;
    align-items: flex-end;
  }
  .grow {
    flex: 1 1 24ch;
    max-width: 48ch;
  }
</style>
