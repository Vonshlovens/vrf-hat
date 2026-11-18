<!-- Host only: who gets an email after each round. -->
<script lang="ts">
  import { enhance } from "$app/forms";

  let {
    settings,
    org,
    error,
    saved,
  }: {
    settings: {
      emailHost: boolean;
      emailMembers: boolean;
      recipients: string[];
      memberCount: number | null;
      max: number;
    };
    org: { name: string } | null;
    error?: string;
    saved?: boolean;
  } = $props();

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const full = $derived(settings.recipients.length >= settings.max);
</script>

<details class="more" open={Boolean(error || saved)}>
  <summary class="small">Result emails</summary>
  <div class="emails">
    <p class="hint">
      After each draw: who was picked, who's left, and a link to check it. Only you can see this list.
    </p>

    <form method="POST" action="?/emailOptions" use:enhance={() => ({ update }) => update({ reset: false })} class="form">
      <label class="check">
        <input name="emailHost" type="checkbox" checked={settings.emailHost} />
        <span>Email me</span>
      </label>
      {#if org && settings.memberCount !== null}
        <label class="check">
          <input name="emailMembers" type="checkbox" checked={settings.emailMembers} />
          <span>
            Email every member of {org.name}
            <span class="hint">{plural(settings.memberCount, "member")} now; people who join later are included.</span>
          </span>
        </label>
      {/if}
      <div class="btn-row">
        <button class="btn small">Save</button>
        {#if saved}<span class="status" data-tone="ok">saved</span>{/if}
      </div>
    </form>

    <form method="POST" action="?/addRecipients" use:enhance class="form">
      <div class="field">
        <label for="emails">Also email</label>
        <input
          class="input"
          id="emails"
          name="emails"
          type="text"
          inputmode="email"
          autocomplete="off"
          placeholder="name@example.com, another@example.com"
          disabled={full}
          aria-describedby="emails-hint"
        />
        <p class="hint" id="emails-hint">
          {full
            ? `That's the limit of ${settings.max}. Remove one to add another.`
            : `Up to ${settings.max} addresses. Each email says you added them.`}
        </p>
      </div>
      {#if error}<p class="field-error" role="alert">{error}</p>{/if}
      <div class="btn-row">
        <button class="btn small" disabled={full}>Add</button>
      </div>
    </form>

    {#if settings.recipients.length}
      <ul class="list" aria-label="Also emailed">
        {#each settings.recipients as email (email)}
          <li>
            <span class="addr">{email}</span>
            <form method="POST" action="?/removeRecipient" use:enhance>
              <input type="hidden" name="email" value={email} />
              <button class="btn ghost small" aria-label="Stop emailing {email}">Remove</button>
            </form>
          </li>
        {/each}
      </ul>
      <p class="meta small">{settings.recipients.length} of {settings.max}</p>
    {/if}
  </div>
</details>

<style>
  .more summary {
    width: fit-content;
    cursor: pointer;
    color: var(--ink-3);
  }
  .more summary:hover {
    color: var(--ink);
  }
  .emails {
    display: grid;
    gap: var(--lh);
    margin-top: var(--lh);
  }
  .list {
    list-style: none;
    padding: 0;
    border-top: var(--rule-w) solid var(--rule);
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1ch;
    padding: var(--s-1) 0;
    border-bottom: var(--hair-w) solid var(--line);
  }
  .addr {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .list form {
    margin: 0;
  }
</style>
