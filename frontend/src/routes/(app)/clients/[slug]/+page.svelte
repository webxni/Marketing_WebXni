<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import type { Client, ClientPlatform, ClientIntelligence, ClientPlatformLinks } from '$lib/types';

  type Svc   = { id: string; name: string; category_name: string | null; active: number };
  type Area  = { id: string; city: string; state: string | null; zip: string | null; primary_area: number };
  type Offer = { id: string; title: string; description: string | null; cta_text: string | null; valid_until: string | null; active: number };

  let client:    Client | null = null;
  let platforms: ClientPlatform[] = [];
  let loading = true;
  let activeTab: 'profile' | 'platforms' | 'services' | 'areas' | 'offers' | 'intelligence' | 'links' | 'feedback' = 'profile';

  // Intelligence
  let intelligence: ClientIntelligence = { brand_voice: null, tone_keywords: null, prohibited_terms: null,
    approved_ctas: null, content_goals: null, service_priorities: null, content_angles: null,
    seasonal_notes: null, competitor_notes: null, audience_notes: null, primary_keyword: null,
    secondary_keywords: null, local_seo_themes: null, generation_language: null,
    humanization_style: null, monthly_snapshot: null, feedback_summary: null, last_research_at: null };
  let intelligenceLoaded = false;
  let savingIntelligence = false;

  async function loadIntelligence(slug: string) {
    try { const r = await clientsApi.getIntelligence(slug); intelligence = r.intelligence as ClientIntelligence; intelligenceLoaded = true; } catch {}
  }
  async function saveIntelligence() {
    if (!client) return;
    savingIntelligence = true;
    try { await clientsApi.saveIntelligence(client.slug, intelligence as Record<string, unknown>); toast.success('Intelligence saved'); }
    catch { toast.error('Failed to save'); }
    finally { savingIntelligence = false; }
  }

  // Platform links
  let platformLinks: ClientPlatformLinks = {};
  let linksLoaded = false;
  let savingLinks = false;

  async function loadPlatformLinks(slug: string) {
    try { const r = await clientsApi.getPlatformLinks(slug); platformLinks = r.links as ClientPlatformLinks; linksLoaded = true; } catch {}
  }
  async function savePlatformLinks() {
    if (!client) return;
    savingLinks = true;
    try { await clientsApi.savePlatformLinks(client.slug, platformLinks as Record<string, unknown>); toast.success('Links saved'); }
    catch { toast.error('Failed to save'); }
    finally { savingLinks = false; }
  }

  async function deletePlatform(p: ClientPlatform) {
    if (!client) return;
    if (!confirm(`Remove ${p.platform} from ${client.canonical_name}?`)) return;
    try { await clientsApi.deletePlatform(client.slug, p.platform); toast.success(`${p.platform} removed`); load(); }
    catch { toast.error('Failed to remove platform'); }
  }

  // Platform add/edit form
  const ALL_PLATFORMS = ['facebook','instagram','linkedin','x','threads','tiktok','pinterest','bluesky','youtube','google_business','website_blog'];
  let showPlatformForm = false;
  let editingPlatform: Partial<ClientPlatform> & { platform: string } = { platform: '' };
  let savingPlatform = false;
  let platformFormEl: HTMLElement | null = null;

  function openAddPlatform() {
    editingPlatform = { platform: '', account_id: null, username: null, page_id: null,
      upload_post_board_id: null, upload_post_location_id: null, profile_url: null,
      profile_username: null, yt_channel_id: null, linkedin_urn: null, notes: null };
    showPlatformForm = true;
    setTimeout(() => platformFormEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function openEditPlatform(p: ClientPlatform) {
    editingPlatform = { ...p };
    showPlatformForm = true;
    setTimeout(() => platformFormEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function savePlatform() {
    if (!client || !editingPlatform.platform) { toast.error('Select a platform'); return; }
    savingPlatform = true;
    try {
      const { platform, ...data } = editingPlatform;
      await clientsApi.updatePlatform(client.slug, platform, data as Record<string, unknown>);
      toast.success(`${platform} saved`);
      showPlatformForm = false;
      load();
    } catch (e) { toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`); }
    finally { savingPlatform = false; }
  }

  let services: Svc[]   = [];
  let areas:    Area[]  = [];
  let offers:   Offer[] = [];

  // Add-service form
  let newSvcName = '';
  let addingSvc = false;
  async function addService() {
    if (!client || !newSvcName.trim()) return;
    addingSvc = true;
    try {
      await clientsApi.createService(client.slug, { name: newSvcName.trim() });
      newSvcName = '';
      loadServices(client.slug);
    } catch { toast.error('Failed to add service'); }
    finally { addingSvc = false; }
  }
  async function removeService(id: string) {
    if (!client) return;
    try { await clientsApi.deleteService(client.slug, id); loadServices(client.slug); }
    catch { toast.error('Failed to remove'); }
  }

  // Add-area form
  let newAreaCity = '';
  let newAreaState = '';
  let newAreaPrimary = false;
  let addingArea = false;
  async function addArea() {
    if (!client || !newAreaCity.trim()) return;
    addingArea = true;
    try {
      await clientsApi.createArea(client.slug, { city: newAreaCity.trim(), state: newAreaState.trim() || undefined, primary_area: newAreaPrimary });
      newAreaCity = ''; newAreaState = ''; newAreaPrimary = false;
      loadAreas(client.slug);
    } catch { toast.error('Failed to add area'); }
    finally { addingArea = false; }
  }
  async function removeArea(id: string) {
    if (!client) return;
    try { await clientsApi.deleteArea(client.slug, id); loadAreas(client.slug); }
    catch { toast.error('Failed to remove'); }
  }

  // Add-offer form
  let newOfferTitle = '';
  let newOfferDesc = '';
  let newOfferCta = '';
  let newOfferUntil = '';
  let addingOffer = false;
  async function addOffer() {
    if (!client || !newOfferTitle.trim()) return;
    addingOffer = true;
    try {
      await clientsApi.createOffer(client.slug, {
        title: newOfferTitle.trim(),
        description: newOfferDesc.trim() || undefined,
        cta_text: newOfferCta.trim() || undefined,
        valid_until: newOfferUntil || undefined,
        active: true,
      });
      newOfferTitle = ''; newOfferDesc = ''; newOfferCta = ''; newOfferUntil = '';
      loadOffers(client.slug);
    } catch { toast.error('Failed to add offer'); }
    finally { addingOffer = false; }
  }
  async function removeOffer(id: string) {
    if (!client) return;
    try { await clientsApi.deleteOffer(client.slug, id); loadOffers(client.slug); }
    catch { toast.error('Failed to remove'); }
  }
  async function toggleOffer(offer: Offer) {
    if (!client) return;
    try {
      await clientsApi.updateOffer(client.slug, offer.id, { active: !offer.active });
      loadOffers(client.slug);
    } catch { toast.error('Failed to update'); }
  }

  async function load() {
    loading = true;
    try {
      const r = await clientsApi.get($page.params.slug ?? '');
      client    = r.client;
      platforms = r.client.platforms ?? [];
    } finally { loading = false; }
  }

  onMount(load);

  async function togglePause(p: ClientPlatform) {
    if (!client) return;
    try {
      if (p.paused) await clientsApi.unpausePlatform(client.slug, p.platform);
      else          await clientsApi.pausePlatform(client.slug, p.platform);
      toast.success(`${p.platform} ${p.paused ? 'unpaused' : 'paused'}`);
      load();
    } catch { toast.error('Failed to update platform'); }
  }

  async function loadServices(slug: string) {
    try { const r = await clientsApi.getServices(slug); services = r.services as Svc[]; } catch {}
  }
  async function loadAreas(slug: string) {
    try { const r = await clientsApi.getAreas(slug); areas = r.areas as Area[]; } catch {}
  }
  async function loadOffers(slug: string) {
    try { const r = await clientsApi.getOffers(slug); offers = r.offers as Offer[]; } catch {}
  }

  // Feedback tab
  type Feedback = { id: string; month: string; category: string | null; sentiment: string | null; message: string | null; admin_reviewed: number; applied_to_intelligence: number; created_at: number };
  let feedback: Feedback[] = [];
  let newFbMessage = '';
  let newFbCategory = 'general';
  let newFbSentiment = 'neutral';
  let newFbMonth = new Date().toISOString().slice(0, 7);
  let addingFb = false;

  async function loadFeedback(slug: string) {
    try { const r = await clientsApi.getFeedback(slug); feedback = r.feedback as Feedback[]; } catch {}
  }
  async function addFeedback() {
    if (!client || !newFbMessage.trim()) return;
    addingFb = true;
    try {
      await clientsApi.addFeedback(client.slug, {
        message: newFbMessage.trim(), category: newFbCategory, sentiment: newFbSentiment, month: newFbMonth
      });
      newFbMessage = '';
      loadFeedback(client.slug);
    } catch { toast.error('Failed to add feedback'); }
    finally { addingFb = false; }
  }
  async function removeFeedback(id: string) {
    if (!client) return;
    try { await clientsApi.deleteFeedback(client.slug, id); loadFeedback(client.slug); }
    catch { toast.error('Failed to remove'); }
  }
  async function toggleFeedbackReviewed(fb: Feedback) {
    if (!client) return;
    try { await clientsApi.updateFeedback(client.slug, fb.id, { admin_reviewed: !fb.admin_reviewed }); loadFeedback(client.slug); }
    catch { toast.error('Failed to update'); }
  }

  // Platform links helpers (avoid TypeScript cast in template)
  function getLinkValue(key: string): string {
    return (platformLinks as Record<string, string | null | undefined>)[key] ?? '';
  }
  function setLinkValue(key: string, value: string) {
    (platformLinks as Record<string, string>)[key] = value;
    platformLinks = platformLinks;
  }

  $: brand = client?.brand_json ? JSON.parse(client.brand_json) : null;

  function switchTab(t: string) { activeTab = t as typeof activeTab; }
  $: if (client && activeTab === 'services')     loadServices(client.slug);
  $: if (client && activeTab === 'areas')        loadAreas(client.slug);
  $: if (client && activeTab === 'offers')       loadOffers(client.slug);
  $: if (client && activeTab === 'intelligence') loadIntelligence(client.slug);
  $: if (client && activeTab === 'links')        loadPlatformLinks(client.slug);
  $: if (client && activeTab === 'feedback')     loadFeedback(client.slug);
</script>

<svelte:head><title>{client?.canonical_name ?? 'Client'} — WebXni</title></svelte:head>

{#if loading}
  <div class="flex justify-center py-20"><Spinner size="lg" /></div>
{:else if client}
  <!-- Header -->
  <div class="page-header">
    <div>
      <div class="flex items-center gap-2 text-xs text-muted mb-1">
        <a href="/clients" class="hover:text-white">Clients</a>
        <span>/</span>
        <span>{client.canonical_name}</span>
      </div>
      <h1 class="page-title">{client.canonical_name}</h1>
      <div class="flex items-center gap-2 mt-1">
        <Badge status={client.status ?? 'active'} />
        <span class="text-xs text-muted capitalize">{client.package}</span>
        {#if client.manual_only === 1}
          <span class="badge-blocked badge">manual only</span>
        {/if}
      </div>
    </div>
    {#if can('clients.edit')}
      <a href="/clients/{client.slug}/edit" class="btn-secondary btn-sm">Edit</a>
    {/if}
  </div>

  <!-- Tabs -->
  <div class="flex flex-wrap border-b border-border mb-6 gap-0">
    {#each [
      { key: 'profile',      label: 'Profile'      },
      { key: 'platforms',    label: 'Platforms'    },
      { key: 'intelligence', label: 'Intelligence' },
      { key: 'links',        label: 'Social Links' },
      { key: 'services',     label: 'Services'     },
      { key: 'areas',        label: 'Areas'        },
      { key: 'offers',       label: 'Offers'       },
      { key: 'feedback',     label: 'Feedback'     },
    ] as tab}
      <button
        class="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
               {activeTab === tab.key ? 'border-accent text-white' : 'border-transparent text-muted hover:text-white'}"
        on:click={() => switchTab(tab.key)}
      >{tab.label}</button>
    {/each}
  </div>

  <!-- Profile tab -->
  {#if activeTab === 'profile'}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
    {#if client.logo_url || client.brand_primary_color || client.brand_accent_color}
    <div class="card p-5 md:col-span-2">
      <h3 class="section-label mb-4">Branding</h3>
      <div class="flex items-center gap-5 flex-wrap">
        {#if client.logo_url}
          <img src={client.logo_url} alt="{client.canonical_name} logo" class="w-20 h-20 object-contain rounded border border-border bg-surface" />
        {/if}
        <div class="flex gap-4">
          {#if client.brand_primary_color}
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded border border-border" style="background:{client.brand_primary_color}"></span>
              <div>
                <div class="text-xs text-muted">Primary</div>
                <div class="text-xs text-white font-mono">{client.brand_primary_color}</div>
              </div>
            </div>
          {/if}
          {#if client.brand_accent_color}
            <div class="flex items-center gap-2">
              <span class="w-6 h-6 rounded border border-border" style="background:{client.brand_accent_color}"></span>
              <div>
                <div class="text-xs text-muted">Accent</div>
                <div class="text-xs text-white font-mono">{client.brand_accent_color}</div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
    {/if}

    <div class="card p-5">
      <h3 class="section-label mb-4">General</h3>
      <dl class="space-y-3">
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Slug</dt>
          <dd class="text-xs font-mono text-white">{client.slug}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Language</dt>
          <dd class="text-xs text-white uppercase">{client.language ?? '—'}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">Upload-Post Profile</dt>
          <dd class="text-xs font-mono text-white">{client.upload_post_profile ?? '—'}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-xs text-muted">WordPress Domain</dt>
          <dd class="text-xs text-white">{client.wp_domain ?? '—'}</dd>
        </div>
        {#if client.requires_approval_from}
          <div class="flex justify-between">
            <dt class="text-xs text-muted">Approval Required From</dt>
            <dd class="text-xs text-yellow-400">{client.requires_approval_from}</dd>
          </div>
        {/if}
        {#if client.notes}
          <div>
            <dt class="text-xs text-muted mb-1">Notes</dt>
            <dd class="text-xs text-white bg-surface rounded p-2">{client.notes}</dd>
          </div>
        {/if}
      </dl>
    </div>

    {#if brand}
    <div class="card p-5">
      <h3 class="section-label mb-4">Brand</h3>
      <dl class="space-y-3">
        {#each Object.entries(brand) as [k, v]}
          <div class="flex justify-between items-center">
            <dt class="text-xs text-muted capitalize">{k.replace(/_/g, ' ')}</dt>
            <dd class="text-xs text-white">
              {#if k.includes('color')}
                <span class="inline-flex items-center gap-1.5">
                  <span class="w-3 h-3 rounded-full border border-border" style="background:{v}"></span>
                  {v}
                </span>
              {:else}
                {v}
              {/if}
            </dd>
          </div>
        {/each}
      </dl>
    </div>
    {/if}
  </div>
  {/if}

  <!-- Platforms tab -->
  {#if activeTab === 'platforms'}
  {#if showPlatformForm}
  <div class="card p-5 mb-4" bind:this={platformFormEl}>
    <h3 class="section-label mb-4">{editingPlatform.id ? 'Edit Platform' : 'Add Platform'}</h3>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div>
        <label class="block text-xs text-muted mb-1">Platform <span class="text-red-400">*</span></label>
        {#if editingPlatform.id}
          <input type="text" value={editingPlatform.platform} class="input w-full text-sm capitalize opacity-60" readonly />
        {:else}
          <select bind:value={editingPlatform.platform} class="input w-full text-sm">
            <option value="">— select —</option>
            {#each ALL_PLATFORMS.filter(p => !platforms.find(x => x.platform === p)) as p}
              <option value={p}>{p.replace(/_/g, ' ')}</option>
            {/each}
          </select>
        {/if}
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Username</label>
        <input type="text" bind:value={editingPlatform.username} class="input w-full text-sm" placeholder="@handle or login" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Account ID</label>
        <input type="text" bind:value={editingPlatform.account_id} class="input w-full text-sm font-mono" placeholder="Platform account ID" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Page ID</label>
        <input type="text" bind:value={editingPlatform.page_id} class="input w-full text-sm font-mono" placeholder="Facebook/LinkedIn page ID" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Upload-Post Board ID</label>
        <input type="text" bind:value={editingPlatform.upload_post_board_id} class="input w-full text-sm font-mono" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Upload-Post Location ID</label>
        <input type="text" bind:value={editingPlatform.upload_post_location_id} class="input w-full text-sm font-mono" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Profile URL</label>
        <input type="url" bind:value={editingPlatform.profile_url} class="input w-full text-sm" placeholder="https://…" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Profile Username</label>
        <input type="text" bind:value={editingPlatform.profile_username} class="input w-full text-sm" />
      </div>
      {#if editingPlatform.platform === 'youtube'}
      <div>
        <label class="block text-xs text-muted mb-1">YouTube Channel ID</label>
        <input type="text" bind:value={editingPlatform.yt_channel_id} class="input w-full text-sm font-mono" />
      </div>
      {/if}
      {#if editingPlatform.platform === 'linkedin'}
      <div>
        <label class="block text-xs text-muted mb-1">LinkedIn URN</label>
        <input type="text" bind:value={editingPlatform.linkedin_urn} class="input w-full text-sm font-mono" placeholder="urn:li:organization:…" />
      </div>
      {/if}
      <div class="md:col-span-3">
        <label class="block text-xs text-muted mb-1">Notes</label>
        <input type="text" bind:value={editingPlatform.notes} class="input w-full text-sm" placeholder="Internal notes…" />
      </div>
    </div>
    <div class="flex gap-2 justify-end">
      <button class="btn-ghost btn-sm" on:click={() => showPlatformForm = false}>Cancel</button>
      <button class="btn-primary btn-sm" on:click={savePlatform} disabled={savingPlatform}>
        {savingPlatform ? 'Saving…' : editingPlatform.id ? 'Update' : 'Add Platform'}
      </button>
    </div>
  </div>
  {/if}

  <div class="card">
    <div class="px-5 py-3 border-b border-border flex items-center justify-between">
      <span class="text-sm font-medium text-white">{platforms.length} platforms</span>
      {#if can('clients.edit') && !showPlatformForm}
        <button class="btn-primary btn-sm text-xs" on:click={openAddPlatform}>+ Add Platform</button>
      {/if}
    </div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Platform</th>
            <th>Username / Page ID</th>
            <th>Profile URL</th>
            <th>Status</th>
            <th>Pause Reason</th>
            {#if can('clients.edit')}<th></th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each platforms as p}
            <tr>
              <td><PlatformBadge platform={p.platform} /></td>
              <td class="font-mono text-xs text-muted">{p.username ?? p.page_id ?? '—'}</td>
              <td class="text-xs">
                {#if p.profile_url}
                  <a href={p.profile_url} target="_blank" rel="noopener noreferrer" class="text-accent hover:underline truncate max-w-[200px] block">
                    {p.profile_url.replace(/^https?:\/\//, '')}
                  </a>
                {:else}
                  <span class="text-muted">—</span>
                {/if}
              </td>
              <td><Badge status={p.paused === 1 ? 'blocked' : 'active'} /></td>
              <td class="text-xs text-muted">{p.paused_reason ?? '—'}</td>
              {#if can('clients.edit')}
              <td class="flex gap-1">
                <button class="btn-ghost btn-sm text-xs" on:click={() => openEditPlatform(p)}>Edit</button>
                <button class="btn-ghost btn-sm text-xs" on:click={() => togglePause(p)}>
                  {p.paused === 1 ? 'Unpause' : 'Pause'}
                </button>
                <button class="btn-ghost btn-sm text-xs text-red-400" on:click={() => deletePlatform(p)}>Remove</button>
              </td>
              {/if}
            </tr>
          {/each}
          {#if platforms.length === 0}
            <tr><td colspan="6" class="text-center text-muted text-sm py-8">No platforms configured.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
  {/if}
  <!-- Intelligence tab -->
  {#if activeTab === 'intelligence'}
  <div class="space-y-5">
    <div class="card p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="section-label">Brand Intelligence</h3>
        {#if can('clients.edit')}
          <button class="btn-primary btn-sm" on:click={saveIntelligence} disabled={savingIntelligence}>
            {savingIntelligence ? 'Saving…' : 'Save'}
          </button>
        {/if}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-muted mb-1">Brand Voice</label>
          <textarea bind:value={intelligence.brand_voice} rows="3" class="input w-full text-sm resize-none"
            placeholder="e.g. Professional, approachable, expert…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Content Goals</label>
          <textarea bind:value={intelligence.content_goals} rows="3" class="input w-full text-sm resize-none"
            placeholder="e.g. Generate leads, build trust, educate…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Content Angles</label>
          <textarea bind:value={intelligence.content_angles} rows="3" class="input w-full text-sm resize-none"
            placeholder="e.g. Before/after, FAQ, testimonials…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Service Priorities</label>
          <textarea bind:value={intelligence.service_priorities} rows="3" class="input w-full text-sm resize-none"
            placeholder="e.g. Roof replacement > repairs > inspections…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Prohibited Terms</label>
          <textarea bind:value={intelligence.prohibited_terms} rows="2" class="input w-full text-sm resize-none"
            placeholder="Terms to never use…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Approved CTAs</label>
          <textarea bind:value={intelligence.approved_ctas} rows="2" class="input w-full text-sm resize-none"
            placeholder="e.g. Call now, Get a free quote…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Primary Keyword</label>
          <input type="text" bind:value={intelligence.primary_keyword} class="input w-full text-sm"
            placeholder="e.g. roofing contractor Los Angeles" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Secondary Keywords</label>
          <input type="text" bind:value={intelligence.secondary_keywords} class="input w-full text-sm"
            placeholder="Comma-separated…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Local SEO Themes</label>
          <textarea bind:value={intelligence.local_seo_themes} rows="2" class="input w-full text-sm resize-none"
            placeholder="e.g. Serving LA, Pasadena, Glendale…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Audience Notes</label>
          <textarea bind:value={intelligence.audience_notes} rows="2" class="input w-full text-sm resize-none"
            placeholder="Target demographics, pain points…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Seasonal Notes</label>
          <textarea bind:value={intelligence.seasonal_notes} rows="2" class="input w-full text-sm resize-none"
            placeholder="e.g. Summer = AC, Winter = heating…" readonly={!can('clients.edit')} />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Humanization Style</label>
          <input type="text" bind:value={intelligence.humanization_style} class="input w-full text-sm"
            placeholder="e.g. conversational, slight humor, no jargon" readonly={!can('clients.edit')} />
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs text-muted mb-1">Monthly Snapshot</label>
          <textarea bind:value={intelligence.monthly_snapshot} rows="3" class="input w-full text-sm resize-none"
            placeholder="Current month context, promotions, focus areas…" readonly={!can('clients.edit')} />
        </div>
        <div class="md:col-span-2">
          <label class="block text-xs text-muted mb-1">Feedback Summary</label>
          <textarea bind:value={intelligence.feedback_summary} rows="3" class="input w-full text-sm resize-none"
            placeholder="What has and hasn't worked for this client…" readonly={!can('clients.edit')} />
        </div>
      </div>
      {#if can('clients.edit')}
        <div class="mt-4 flex justify-end">
          <button class="btn-primary btn-sm" on:click={saveIntelligence} disabled={savingIntelligence}>
            {savingIntelligence ? 'Saving…' : 'Save Intelligence'}
          </button>
        </div>
      {/if}
    </div>
  </div>
  {/if}

  <!-- Platform Links tab -->
  {#if activeTab === 'links'}
  <div class="card p-5">
    <div class="flex items-center justify-between mb-4">
      <h3 class="section-label">Social Profile Links</h3>
      {#if can('clients.edit')}
        <button class="btn-primary btn-sm" on:click={savePlatformLinks} disabled={savingLinks}>
          {savingLinks ? 'Saving…' : 'Save'}
        </button>
      {/if}
    </div>
    <p class="text-xs text-muted mb-4">Public profile URLs for each platform — used in reports and client portals.</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      {#each [
        { key: 'facebook',        label: 'Facebook' },
        { key: 'instagram',       label: 'Instagram' },
        { key: 'tiktok',          label: 'TikTok' },
        { key: 'youtube',         label: 'YouTube' },
        { key: 'linkedin',        label: 'LinkedIn' },
        { key: 'pinterest',       label: 'Pinterest' },
        { key: 'x',               label: 'X / Twitter' },
        { key: 'threads',         label: 'Threads' },
        { key: 'bluesky',         label: 'Bluesky' },
        { key: 'google_business', label: 'Google Business' },
        { key: 'website',         label: 'Website' },
      ] as link}
        <div>
          <label class="block text-xs text-muted mb-1">{link.label}</label>
          <input
            type="url"
            value={getLinkValue(link.key)}
            on:input={(e) => setLinkValue(link.key, e.currentTarget.value)}
            class="input w-full text-sm"
            placeholder="https://…"
            readonly={!can('clients.edit')}
          />
        </div>
      {/each}
    </div>
  </div>
  {/if}

{/if}

<!-- Services tab (outside {#if client} so reactive load works) -->
{#if activeTab === 'services' && client}
<div class="space-y-4">
  {#if can('clients.edit')}
  <div class="card p-4">
    <h3 class="section-label mb-3">Add Service</h3>
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={newSvcName}
        placeholder="Service name…"
        class="input flex-1 text-sm"
        on:keydown={(e) => e.key === 'Enter' && addService()}
      />
      <button class="btn-primary btn-sm" on:click={addService} disabled={addingSvc || !newSvcName.trim()}>
        {addingSvc ? 'Adding…' : 'Add'}
      </button>
    </div>
  </div>
  {/if}
  {#if services.length === 0}
    <p class="text-sm text-muted text-center py-8">No services added yet.</p>
  {:else}
    <div class="card divide-y divide-border">
      {#each services as svc}
        <div class="px-4 py-3 flex items-center justify-between">
          <div>
            <div class="text-sm text-white">{svc.name}</div>
            {#if svc.category_name}<div class="text-xs text-muted">{svc.category_name}</div>{/if}
          </div>
          <div class="flex items-center gap-2">
            <Badge status={svc.active ? 'active' : 'inactive'} />
            {#if can('clients.edit')}
              <button class="btn-ghost btn-sm text-xs text-red-400" on:click={() => removeService(svc.id)}>Remove</button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}

{#if activeTab === 'areas' && client}
<div class="space-y-4">
  {#if can('clients.edit')}
  <div class="card p-4">
    <h3 class="section-label mb-3">Add Service Area</h3>
    <div class="flex gap-2 flex-wrap">
      <input type="text" bind:value={newAreaCity} placeholder="City *" class="input text-sm w-36"
        on:keydown={(e) => e.key === 'Enter' && addArea()} />
      <input type="text" bind:value={newAreaState} placeholder="State" class="input text-sm w-24" />
      <label class="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
        <input type="checkbox" bind:checked={newAreaPrimary} class="rounded" />
        Primary
      </label>
      <button class="btn-primary btn-sm" on:click={addArea} disabled={addingArea || !newAreaCity.trim()}>
        {addingArea ? 'Adding…' : 'Add'}
      </button>
    </div>
  </div>
  {/if}
  {#if areas.length === 0}
    <p class="text-sm text-muted text-center py-8">No service areas added yet.</p>
  {:else}
  <div class="card">
    <div class="divide-y divide-border">
      {#each areas as area}
        <div class="px-4 py-3 flex items-center justify-between">
          <div class="flex items-center gap-2">
            {#if area.primary_area}<span class="badge-info badge text-[10px]">Primary</span>{/if}
            <span class="text-sm text-white">{area.city}{area.state ? `, ${area.state}` : ''}</span>
            {#if area.zip}<span class="text-xs text-muted">{area.zip}</span>{/if}
          </div>
          {#if can('clients.edit')}
            <button class="btn-ghost btn-sm text-xs text-red-400" on:click={() => removeArea(area.id)}>Remove</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  {/if}
</div>
{/if}

{#if activeTab === 'offers' && client}
<div class="space-y-4">
  {#if can('clients.edit')}
  <div class="card p-4">
    <h3 class="section-label mb-3">Add Offer</h3>
    <div class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-muted mb-1">Title <span class="text-red-400">*</span></label>
          <input type="text" bind:value={newOfferTitle} placeholder="e.g. 10% Off First Service" class="input w-full text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">CTA Text</label>
          <input type="text" bind:value={newOfferCta} placeholder="e.g. Claim Offer" class="input w-full text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Description</label>
          <input type="text" bind:value={newOfferDesc} placeholder="Short description…" class="input w-full text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Valid Until</label>
          <input type="date" bind:value={newOfferUntil} class="input w-full text-sm" />
        </div>
      </div>
      <div class="flex justify-end">
        <button class="btn-primary btn-sm" on:click={addOffer} disabled={addingOffer || !newOfferTitle.trim()}>
          {addingOffer ? 'Adding…' : 'Add Offer'}
        </button>
      </div>
    </div>
  </div>
  {/if}
  {#if offers.length === 0}
    <p class="text-sm text-muted text-center py-8">No offers added yet.</p>
  {:else}
    {#each offers as offer}
      <div class="card p-4 flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-white">{offer.title}</div>
          {#if offer.description}<div class="text-xs text-muted mt-1">{offer.description}</div>{/if}
          {#if offer.cta_text}<div class="text-xs text-accent mt-1">{offer.cta_text}</div>{/if}
          {#if offer.valid_until}<div class="text-xs text-muted mt-1">Valid until {offer.valid_until}</div>{/if}
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button class="text-xs text-muted hover:text-white" on:click={() => toggleOffer(offer)}>
            <Badge status={offer.active ? 'active' : 'inactive'} />
          </button>
          {#if can('clients.edit')}
            <button class="btn-ghost btn-sm text-xs text-red-400" on:click={() => removeOffer(offer.id)}>Remove</button>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
{/if}

{#if activeTab === 'feedback' && client}
<div class="space-y-4">
  {#if can('clients.edit')}
  <div class="card p-4">
    <h3 class="section-label mb-3">Add Feedback</h3>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
      <div>
        <label class="block text-xs text-muted mb-1">Month</label>
        <input type="month" bind:value={newFbMonth} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Category</label>
        <select bind:value={newFbCategory} class="input w-full text-sm">
          <option value="general">General</option>
          <option value="content">Content Quality</option>
          <option value="caption">Captions</option>
          <option value="design">Design / Assets</option>
          <option value="timing">Timing / Schedule</option>
          <option value="platform">Platform-Specific</option>
          <option value="results">Results / Performance</option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Sentiment</label>
        <select bind:value={newFbSentiment} class="input w-full text-sm">
          <option value="positive">Positive</option>
          <option value="neutral">Neutral</option>
          <option value="negative">Negative</option>
          <option value="request">Request / Change</option>
        </select>
      </div>
    </div>
    <div class="flex gap-2">
      <textarea
        bind:value={newFbMessage}
        rows="2"
        placeholder="Describe the feedback, client note, or action item…"
        class="input flex-1 text-sm resize-none"
        on:keydown={(e) => e.key === 'Enter' && e.ctrlKey && addFeedback()}
      ></textarea>
      <button class="btn-primary btn-sm self-end" on:click={addFeedback} disabled={addingFb || !newFbMessage.trim()}>
        {addingFb ? 'Adding…' : 'Add'}
      </button>
    </div>
  </div>
  {/if}

  {#if feedback.length === 0}
    <p class="text-sm text-muted text-center py-8">No feedback recorded yet.</p>
  {:else}
    <div class="space-y-2">
      {#each feedback as fb}
        <div class="card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="text-xs font-mono text-muted">{fb.month}</span>
                {#if fb.category}
                  <span class="text-[10px] px-2 py-0.5 rounded-full bg-surface border border-border text-muted capitalize">
                    {fb.category.replace(/_/g, ' ')}
                  </span>
                {/if}
                {#if fb.sentiment}
                  <span class="text-[10px] px-2 py-0.5 rounded-full border capitalize
                    {fb.sentiment === 'positive' ? 'border-green-500/30 text-green-400 bg-green-500/5'
                     : fb.sentiment === 'negative' ? 'border-red-500/30 text-red-400 bg-red-500/5'
                     : fb.sentiment === 'request' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5'
                     : 'border-border text-muted'}">
                    {fb.sentiment}
                  </span>
                {/if}
                {#if fb.admin_reviewed}
                  <span class="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-400 bg-blue-500/5">reviewed</span>
                {/if}
                {#if fb.applied_to_intelligence}
                  <span class="text-[10px] px-2 py-0.5 rounded-full border border-purple-500/30 text-purple-400 bg-purple-500/5">applied</span>
                {/if}
              </div>
              <p class="text-sm text-white">{fb.message}</p>
            </div>
            {#if can('clients.edit')}
              <div class="flex gap-1 flex-shrink-0">
                <button class="btn-ghost btn-sm text-xs" title="Toggle reviewed" on:click={() => toggleFeedbackReviewed(fb)}>
                  {fb.admin_reviewed ? 'Unmark' : 'Mark reviewed'}
                </button>
                <button class="btn-ghost btn-sm text-xs text-red-400" on:click={() => removeFeedback(fb.id)}>Delete</button>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
{/if}
