<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { clientsApi } from '$lib/api';
  import Badge from '$lib/components/ui/Badge.svelte';
  import PlatformBadge from '$lib/components/ui/PlatformBadge.svelte';
  import Spinner from '$lib/components/ui/Spinner.svelte';
  import { can } from '$lib/stores/auth';
  import { toast } from '$lib/stores/ui';
  import type { Client, ClientPlatform, ClientIntelligence, ClientOffer, ClientEvent } from '$lib/types';

  type Svc   = { id: string; name: string; category_name: string | null; active: number };
  type Area  = { id: string; city: string; state: string | null; zip: string | null; primary_area: number };

  let client:    Client | null = null;
  let platforms: ClientPlatform[] = [];
  let loading = true;
  let activeTab: 'profile' | 'platforms' | 'intelligence' | 'services' | 'areas' | 'gbp' | 'feedback' = 'profile';

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

  let services: Svc[]         = [];
  let areas:    Area[]        = [];
  let offers:   ClientOffer[] = [];
  let events:   ClientEvent[] = [];

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

  // ── Unified GBP section ───────────────────────────────────────────────────────
  const GBP_CTA_TYPES = ['BOOK','ORDER','SHOP','LEARN_MORE','SIGN_UP','CALL'] as const;
  const RECURRENCE_OPTS = [
    { value: 'none',      label: 'One-time (manual only)' },
    { value: 'weekly',    label: 'Weekly' },
    { value: 'biweekly',  label: 'Biweekly (quincenal)' },
    { value: 'monthly',   label: 'Monthly' },
  ];
  const EVENT_RECURRENCE_OPTS = [
    { value: 'once',      label: 'One-time (posts once)' },
    { value: 'weekly',    label: 'Weekly' },
    { value: 'biweekly',  label: 'Biweekly (quincenal)' },
    { value: 'monthly',   label: 'Monthly' },
  ];

  let gbpPostType: 'offer' | 'event' = 'offer';
  let generatingGbp  = false;
  let submittingGbp  = false;
  let gbpVariations: Array<Record<string, string>> = [];
  let expandedGbpIds = new Set<string>();
  let showInactiveGbp = false;
  let editingOffer: ClientOffer | null = null;
  let editingEvent: ClientEvent | null = null;
  let uploadingGbpId: string | null = null;

  // Unified creation form
  let gbpForm = {
    title: '', description: '', cta_text: '', valid_until: '',
    gbp_cta_type: '', gbp_cta_url: '', gbp_coupon_code: '', gbp_redeem_url: '',
    gbp_terms: '', recurrence: 'none', next_run_date: '', gbp_location_id: '',
    gbp_event_title: '', gbp_event_start_date: '', gbp_event_start_time: '',
    gbp_event_end_date: '', gbp_event_end_time: '',
    ai_image_prompt: '',
  };

  function resetGbpForm() {
    gbpForm = {
      title: '', description: '', cta_text: '', valid_until: '',
      gbp_cta_type: '', gbp_cta_url: '', gbp_coupon_code: '', gbp_redeem_url: '',
      gbp_terms: '', recurrence: gbpPostType === 'offer' ? 'none' : 'once',
      next_run_date: '', gbp_location_id: '',
      gbp_event_title: '', gbp_event_start_date: '', gbp_event_start_time: '',
      gbp_event_end_date: '', gbp_event_end_time: '',
      ai_image_prompt: '',
    };
  }

  async function submitGbpForm() {
    if (!client || !gbpForm.title.trim()) return;
    submittingGbp = true;
    try {
      if (gbpPostType === 'offer') {
        await clientsApi.createOffer(client.slug, {
          title:            gbpForm.title.trim(),
          description:      gbpForm.description.trim()    || undefined,
          cta_text:         gbpForm.cta_text.trim()       || undefined,
          valid_until:      gbpForm.valid_until            || undefined,
          gbp_cta_type:     gbpForm.gbp_cta_type          || undefined,
          gbp_cta_url:      gbpForm.gbp_cta_url.trim()    || undefined,
          gbp_coupon_code:  gbpForm.gbp_coupon_code.trim()|| undefined,
          gbp_redeem_url:   gbpForm.gbp_redeem_url.trim() || undefined,
          gbp_terms:        gbpForm.gbp_terms.trim()      || undefined,
          gbp_location_id:  gbpForm.gbp_location_id       || undefined,
          recurrence:       gbpForm.recurrence,
          next_run_date:    gbpForm.next_run_date          || undefined,
          ai_image_prompt:  gbpForm.ai_image_prompt.trim()|| undefined,
          active:           true,
        });
      } else {
        await clientsApi.createEvent(client.slug, {
          title:                gbpForm.title.trim(),
          description:          gbpForm.description.trim()      || undefined,
          gbp_event_title:      gbpForm.gbp_event_title.trim()  || undefined,
          gbp_event_start_date: gbpForm.gbp_event_start_date    || undefined,
          gbp_event_start_time: gbpForm.gbp_event_start_time    || undefined,
          gbp_event_end_date:   gbpForm.gbp_event_end_date      || undefined,
          gbp_event_end_time:   gbpForm.gbp_event_end_time      || undefined,
          gbp_cta_type:         gbpForm.gbp_cta_type            || undefined,
          gbp_cta_url:          gbpForm.gbp_cta_url.trim()      || undefined,
          gbp_location_id:      gbpForm.gbp_location_id         || undefined,
          recurrence:           gbpForm.recurrence,
          next_run_date:        gbpForm.next_run_date            || undefined,
          ai_image_prompt:      gbpForm.ai_image_prompt.trim()  || undefined,
          active:               true,
        });
      }
      resetGbpForm();
      loadOffers(client.slug);
      loadEvents(client.slug);
      toast.success(`${gbpPostType === 'offer' ? 'Offer' : 'Event'} added`);
    } catch (e) { toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { submittingGbp = false; }
  }

  async function generateGbpAi() {
    if (!client) return;
    generatingGbp = true;
    gbpVariations = [];
    try {
      const r = await clientsApi.generateGbp(client.slug, gbpPostType);
      gbpVariations = r.variations as Array<Record<string, string>>;
    } catch (e) { toast.error(`AI generation failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { generatingGbp = false; }
  }

  function applyGbpVariation(v: Record<string, string>) {
    gbpForm = {
      ...gbpForm,
      title:            v['title']            ?? '',
      description:      v['description']      ?? '',
      cta_text:         v['cta_text']         ?? '',
      gbp_cta_type:     v['gbp_cta_type']     ?? '',
      gbp_coupon_code:  v['gbp_coupon_code']  ?? '',
      gbp_terms:        v['gbp_terms']        ?? '',
      gbp_event_title:  v['gbp_event_title']  ?? '',
      ai_image_prompt:  v['ai_image_prompt']  ?? '',
    };
    gbpVariations = [];
  }

  function toggleGbpExpand(id: string) {
    if (expandedGbpIds.has(id)) expandedGbpIds.delete(id);
    else expandedGbpIds.add(id);
    expandedGbpIds = expandedGbpIds;
  }

  function startEditOffer(offer: ClientOffer) { editingOffer = { ...offer }; editingEvent = null; }
  function startEditEvent(ev: ClientEvent)    { editingEvent = { ...ev };   editingOffer = null; }
  function cancelGbpEdit() { editingOffer = null; editingEvent = null; }

  async function saveEditOffer() {
    if (!client || !editingOffer) return;
    submittingGbp = true;
    try {
      await clientsApi.updateOffer(client.slug, editingOffer.id, editingOffer as unknown as Record<string, unknown>);
      toast.success('Offer saved');
      editingOffer = null;
      loadOffers(client.slug);
    } catch (e) { toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { submittingGbp = false; }
  }

  async function saveEditEvent() {
    if (!client || !editingEvent) return;
    submittingGbp = true;
    try {
      await clientsApi.updateEvent(client.slug, editingEvent.id, editingEvent as unknown as Record<string, unknown>);
      toast.success('Event saved');
      editingEvent = null;
      loadEvents(client.slug);
    } catch (e) { toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { submittingGbp = false; }
  }

  async function removeOffer(id: string) {
    if (!client) return;
    try { await clientsApi.deleteOffer(client.slug, id); loadOffers(client.slug); }
    catch { toast.error('Failed to remove'); }
  }
  async function removeEvent(id: string) {
    if (!client) return;
    try { await clientsApi.deleteEvent(client.slug, id); loadEvents(client.slug); }
    catch { toast.error('Failed to remove'); }
  }

  async function toggleOffer(offer: ClientOffer) {
    if (!client) return;
    try { await clientsApi.updateOffer(client.slug, offer.id, { active: !offer.active }); loadOffers(client.slug); }
    catch { toast.error('Failed'); }
  }
  async function togglePauseOffer(offer: ClientOffer) {
    if (!client) return;
    try { await clientsApi.updateOffer(client.slug, offer.id, { paused: !offer.paused }); loadOffers(client.slug); }
    catch { toast.error('Failed'); }
  }
  async function toggleEvent(ev: ClientEvent) {
    if (!client) return;
    try { await clientsApi.updateEvent(client.slug, ev.id, { active: !ev.active }); loadEvents(client.slug); }
    catch { toast.error('Failed'); }
  }
  async function togglePauseEvent(ev: ClientEvent) {
    if (!client) return;
    try { await clientsApi.updateEvent(client.slug, ev.id, { paused: !ev.paused }); loadEvents(client.slug); }
    catch { toast.error('Failed'); }
  }

  async function uploadGbpImage(itemType: 'offers' | 'events', itemId: string, file: File) {
    if (!client) return;
    uploadingGbpId = itemId;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await clientsApi.uploadGbpAsset(client.slug, itemType, itemId, fd);
      toast.success('Image uploaded');
      if (itemType === 'offers') loadOffers(client.slug); else loadEvents(client.slug);
    } catch (e) { toast.error(`Upload failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { uploadingGbpId = null; }
  }

  // Sorted combined list helpers
  function gbpSortKey(item: { next_run_date: string | null }): string {
    return item.next_run_date ?? '9999-99-99';
  }

  $: activeGbpItems = [
    ...offers.filter(o => o.active).map(o => ({ ...o, _type: 'offer' as const })),
    ...events.filter(e => e.active).map(e => ({ ...e, _type: 'event' as const })),
  ].sort((a, b) => gbpSortKey(a).localeCompare(gbpSortKey(b)));

  $: inactiveGbpItems = [
    ...offers.filter(o => !o.active).map(o => ({ ...o, _type: 'offer' as const })),
    ...events.filter(e => !e.active).map(e => ({ ...e, _type: 'event' as const })),
  ];

  function handleGbpImageUpload(itemType: 'offers' | 'events', itemId: string, e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (f) uploadGbpImage(itemType, itemId, f);
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
    try { const r = await clientsApi.getOffers(slug); offers = r.offers as ClientOffer[]; } catch {}
  }
  async function loadEvents(slug: string) {
    try { const r = await clientsApi.getEvents(slug); events = r.events as ClientEvent[]; } catch {}
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

  $: brand = client?.brand_json ? JSON.parse(client.brand_json) : null;

  function switchTab(t: string) { activeTab = t as typeof activeTab; }
  $: if (client && activeTab === 'services')     loadServices(client.slug);
  $: if (client && activeTab === 'areas')        loadAreas(client.slug);
  $: if (client && activeTab === 'gbp')          { loadOffers(client.slug); loadEvents(client.slug); }
  $: if (client && activeTab === 'intelligence') loadIntelligence(client.slug);
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
      { key: 'services',     label: 'Services'     },
      { key: 'areas',        label: 'Areas'        },
      { key: 'gbp',          label: 'Google Business' },
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

{#if activeTab === 'gbp' && client}
<div class="space-y-4">

  <!-- Type selector + Standard Post link -->
  <div class="flex items-center justify-between flex-wrap gap-3">
    <div class="flex items-center bg-surface border border-border rounded-lg overflow-hidden text-sm">
      <button
        class="px-4 py-2 transition-colors {gbpPostType === 'offer' ? 'bg-accent text-white' : 'text-muted hover:text-white'}"
        on:click={() => { gbpPostType = 'offer'; resetGbpForm(); gbpVariations = []; }}
      >Offer</button>
      <button
        class="px-4 py-2 transition-colors {gbpPostType === 'event' ? 'bg-accent text-white' : 'text-muted hover:text-white'}"
        on:click={() => { gbpPostType = 'event'; resetGbpForm(); gbpVariations = []; }}
      >Event</button>
    </div>
    <a href="/posts/new?client={client.slug}&platform=google_business" class="btn-secondary btn-sm text-xs">
      + Standard GBP Post
    </a>
  </div>

  {#if can('clients.edit')}
  <!-- AI Generation -->
  <div class="card p-4">
    <div class="flex items-center justify-between mb-2">
      <h3 class="section-label">Generate {gbpPostType === 'offer' ? 'Offer' : 'Event'} with AI</h3>
      <button class="btn-secondary btn-sm text-xs" on:click={generateGbpAi} disabled={generatingGbp}>
        {generatingGbp ? 'Generating…' : 'Generate 3 Variations'}
      </button>
    </div>
    {#if gbpVariations.length > 0}
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      {#each gbpVariations as v, i}
      <button
        class="text-left p-3 rounded-lg border border-border bg-surface hover:border-accent/60 hover:bg-accent/5 transition-all"
        on:click={() => applyGbpVariation(v)}
      >
        <div class="text-[10px] text-accent font-medium mb-1 uppercase tracking-wide">Variation {i + 1}</div>
        <div class="text-xs font-medium text-white mb-1">{v['title'] ?? ''}</div>
        {#if v['description']}<div class="text-[11px] text-muted leading-relaxed line-clamp-3">{v['description']}</div>{/if}
        {#if v['gbp_cta_type']}<div class="text-[10px] text-accent mt-2">CTA: {v['gbp_cta_type']}</div>{/if}
        {#if v['ai_image_prompt']}<div class="text-[10px] text-muted mt-1 italic line-clamp-2">{v['ai_image_prompt']}</div>{/if}
        <div class="text-[10px] text-accent/60 mt-2">Click to apply →</div>
      </button>
      {/each}
    </div>
    {:else if !generatingGbp}
    <p class="text-xs text-muted">Generates 3 variations based on this client's services, brand voice, and intelligence profile.</p>
    {/if}
  </div>

  <!-- Creation form -->
  <div class="card p-4">
    <h3 class="section-label mb-3">{gbpPostType === 'offer' ? 'Add Offer' : 'Add Event'}</h3>
    <div class="space-y-3">

      <!-- Core fields -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-muted mb-1">Internal Title <span class="text-red-400">*</span></label>
          <input type="text" bind:value={gbpForm.title} placeholder="e.g. Spring Sale" class="input w-full text-sm" />
        </div>
        {#if gbpPostType === 'offer'}
        <div>
          <label class="block text-xs text-muted mb-1">CTA Button Text</label>
          <input type="text" bind:value={gbpForm.cta_text} placeholder="e.g. Claim Offer" class="input w-full text-sm" />
        </div>
        {:else}
        <div>
          <label class="block text-xs text-muted mb-1">GBP Display Title</label>
          <input type="text" bind:value={gbpForm.gbp_event_title} placeholder="Same as title if blank" class="input w-full text-sm" />
        </div>
        {/if}
        <div class="sm:col-span-2">
          <label class="block text-xs text-muted mb-1">Description</label>
          <textarea bind:value={gbpForm.description} rows="2" placeholder="Brief description…" class="input w-full text-sm resize-none"></textarea>
        </div>
        {#if gbpPostType === 'offer'}
        <div>
          <label class="block text-xs text-muted mb-1">Valid Until</label>
          <input type="date" bind:value={gbpForm.valid_until} class="input w-full text-sm" />
        </div>
        {:else}
        <div>
          <label class="block text-xs text-muted mb-1">Start Date</label>
          <input type="date" bind:value={gbpForm.gbp_event_start_date} class="input w-full text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">Start Time</label>
          <input type="time" bind:value={gbpForm.gbp_event_start_time} class="input w-full text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">End Date</label>
          <input type="date" bind:value={gbpForm.gbp_event_end_date} class="input w-full text-sm" />
        </div>
        <div>
          <label class="block text-xs text-muted mb-1">End Time</label>
          <input type="time" bind:value={gbpForm.gbp_event_end_time} class="input w-full text-sm" />
        </div>
        {/if}
      </div>

      <!-- GBP Settings -->
      <div class="border-t border-border pt-3">
        <p class="text-xs text-muted mb-2 font-medium">Google Business Profile Settings</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs text-muted mb-1">CTA Type</label>
            <select bind:value={gbpForm.gbp_cta_type} class="input w-full text-sm">
              <option value="">No CTA</option>
              {#each GBP_CTA_TYPES as t}<option value={t}>{t}</option>{/each}
            </select>
          </div>
          {#if gbpForm.gbp_cta_type}
          <div>
            <label class="block text-xs text-muted mb-1">CTA URL {gbpForm.gbp_cta_type !== 'CALL' ? '(required)' : '(optional)'}</label>
            <input type="url" bind:value={gbpForm.gbp_cta_url} placeholder="https://…" class="input w-full text-sm font-mono" />
          </div>
          {/if}
          {#if gbpPostType === 'offer'}
          <div>
            <label class="block text-xs text-muted mb-1">Coupon Code</label>
            <input type="text" bind:value={gbpForm.gbp_coupon_code} placeholder="SAVE10" class="input w-full text-sm font-mono" />
          </div>
          <div>
            <label class="block text-xs text-muted mb-1">Redeem URL</label>
            <input type="url" bind:value={gbpForm.gbp_redeem_url} placeholder="https://…" class="input w-full text-sm font-mono" />
          </div>
          <div class="sm:col-span-2">
            <label class="block text-xs text-muted mb-1">Terms &amp; Conditions</label>
            <input type="text" bind:value={gbpForm.gbp_terms} placeholder="Valid for new customers only." class="input w-full text-sm" />
          </div>
          {/if}
          <div>
            <label class="block text-xs text-muted mb-1">Recurrence</label>
            <select bind:value={gbpForm.recurrence} class="input w-full text-sm">
              {#each (gbpPostType === 'offer' ? RECURRENCE_OPTS : EVENT_RECURRENCE_OPTS) as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
          {#if gbpForm.recurrence !== 'none' && gbpForm.recurrence !== 'once'}
          <div>
            <label class="block text-xs text-muted mb-1">First Run Date</label>
            <input type="date" bind:value={gbpForm.next_run_date} class="input w-full text-sm" />
          </div>
          {/if}
          {#if client.gbp_locations && client.gbp_locations.length > 1}
          <div>
            <label class="block text-xs text-muted mb-1">GBP Location</label>
            <select bind:value={gbpForm.gbp_location_id} class="input w-full text-sm">
              <option value="">All locations</option>
              {#each client.gbp_locations as loc}
                <option value={loc.location_id}>{loc.label}</option>
              {/each}
            </select>
          </div>
          {/if}
        </div>
      </div>

      <!-- Designer section -->
      <div class="border-t border-border pt-3">
        <p class="text-xs text-muted mb-2 font-medium">Diseño / AI Image Brief</p>
        <div>
          <label class="block text-xs text-muted mb-1">AI Image Prompt (Spanish) — 1080×1080px GBP square</label>
          <textarea bind:value={gbpForm.ai_image_prompt} rows="2"
            placeholder="Ej: Diseño cuadrado, fondo azul marino, texto blanco 'Ahorra 10%'…"
            class="input w-full text-sm font-mono resize-none"></textarea>
        </div>
      </div>

      <div class="flex justify-end">
        <button class="btn-primary btn-sm" on:click={submitGbpForm}
          disabled={submittingGbp || !gbpForm.title.trim()}>
          {submittingGbp ? 'Adding…' : gbpPostType === 'offer' ? 'Add Offer' : 'Add Event'}
        </button>
      </div>
    </div>
  </div>
  {/if}

  <!-- Edit panels -->
  {#if editingOffer}
  <div class="card p-4 border border-accent/30">
    <h3 class="section-label mb-3">Edit Offer</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div class="sm:col-span-2">
        <label class="block text-xs text-muted mb-1">Title</label>
        <input type="text" bind:value={editingOffer.title} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Description</label>
        <input type="text" bind:value={editingOffer.description} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">CTA Button Text</label>
        <input type="text" bind:value={editingOffer.cta_text} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Valid Until</label>
        <input type="date" bind:value={editingOffer.valid_until} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Recurrence</label>
        <select bind:value={editingOffer.recurrence} class="input w-full text-sm">
          {#each RECURRENCE_OPTS as opt}<option value={opt.value}>{opt.label}</option>{/each}
        </select>
      </div>
      {#if editingOffer.recurrence !== 'none'}
      <div>
        <label class="block text-xs text-muted mb-1">Next Run Date</label>
        <input type="date" bind:value={editingOffer.next_run_date} class="input w-full text-sm" />
      </div>
      {/if}
      <div>
        <label class="block text-xs text-muted mb-1">GBP CTA Type</label>
        <select bind:value={editingOffer.gbp_cta_type} class="input w-full text-sm">
          <option value="">No CTA</option>
          {#each GBP_CTA_TYPES as t}<option value={t}>{t}</option>{/each}
        </select>
      </div>
      {#if editingOffer.gbp_cta_type}
      <div>
        <label class="block text-xs text-muted mb-1">CTA URL</label>
        <input type="url" bind:value={editingOffer.gbp_cta_url} class="input w-full text-sm font-mono" />
      </div>
      {/if}
      <div>
        <label class="block text-xs text-muted mb-1">Coupon Code</label>
        <input type="text" bind:value={editingOffer.gbp_coupon_code} class="input w-full text-sm font-mono" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Redeem URL</label>
        <input type="url" bind:value={editingOffer.gbp_redeem_url} class="input w-full text-sm font-mono" />
      </div>
      <div class="sm:col-span-2">
        <label class="block text-xs text-muted mb-1">Terms</label>
        <input type="text" bind:value={editingOffer.gbp_terms} class="input w-full text-sm" />
      </div>
      <div class="sm:col-span-2">
        <label class="block text-xs text-muted mb-1">AI Image Brief (Spanish)</label>
        <textarea bind:value={editingOffer.ai_image_prompt} rows="2" class="input w-full text-sm font-mono resize-none"></textarea>
      </div>
    </div>
    <div class="flex justify-end gap-2">
      <button class="btn-secondary btn-sm" on:click={cancelGbpEdit}>Cancel</button>
      <button class="btn-primary btn-sm" on:click={saveEditOffer} disabled={submittingGbp}>Save</button>
    </div>
  </div>
  {/if}

  {#if editingEvent}
  <div class="card p-4 border border-accent/30">
    <h3 class="section-label mb-3">Edit Event</h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
      <div>
        <label class="block text-xs text-muted mb-1">Title</label>
        <input type="text" bind:value={editingEvent.title} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">GBP Display Title</label>
        <input type="text" bind:value={editingEvent.gbp_event_title} class="input w-full text-sm" />
      </div>
      <div class="sm:col-span-2">
        <label class="block text-xs text-muted mb-1">Description</label>
        <input type="text" bind:value={editingEvent.description} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Start Date</label>
        <input type="date" bind:value={editingEvent.gbp_event_start_date} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">Start Time</label>
        <input type="time" bind:value={editingEvent.gbp_event_start_time} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">End Date</label>
        <input type="date" bind:value={editingEvent.gbp_event_end_date} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">End Time</label>
        <input type="time" bind:value={editingEvent.gbp_event_end_time} class="input w-full text-sm" />
      </div>
      <div>
        <label class="block text-xs text-muted mb-1">CTA Type</label>
        <select bind:value={editingEvent.gbp_cta_type} class="input w-full text-sm">
          <option value="">No CTA</option>
          {#each GBP_CTA_TYPES as t}<option value={t}>{t}</option>{/each}
        </select>
      </div>
      {#if editingEvent.gbp_cta_type}
      <div>
        <label class="block text-xs text-muted mb-1">CTA URL</label>
        <input type="url" bind:value={editingEvent.gbp_cta_url} class="input w-full text-sm font-mono" />
      </div>
      {/if}
      <div>
        <label class="block text-xs text-muted mb-1">Recurrence</label>
        <select bind:value={editingEvent.recurrence} class="input w-full text-sm">
          {#each EVENT_RECURRENCE_OPTS as opt}<option value={opt.value}>{opt.label}</option>{/each}
        </select>
      </div>
      {#if editingEvent.recurrence !== 'once'}
      <div>
        <label class="block text-xs text-muted mb-1">Next Run Date</label>
        <input type="date" bind:value={editingEvent.next_run_date} class="input w-full text-sm" />
      </div>
      {/if}
      <div class="sm:col-span-2">
        <label class="block text-xs text-muted mb-1">AI Image Brief (Spanish)</label>
        <textarea bind:value={editingEvent.ai_image_prompt} rows="2" class="input w-full text-sm font-mono resize-none"></textarea>
      </div>
    </div>
    <div class="flex justify-end gap-2">
      <button class="btn-secondary btn-sm" on:click={cancelGbpEdit}>Cancel</button>
      <button class="btn-primary btn-sm" on:click={saveEditEvent} disabled={submittingGbp}>Save</button>
    </div>
  </div>
  {/if}

  <!-- Active items list -->
  {#if activeGbpItems.length === 0}
    <p class="text-sm text-muted text-center py-8">No active GBP items yet. Add an offer or event above.</p>
  {:else}
  <div>
    <h3 class="section-label mb-2">Active Items ({activeGbpItems.length})</h3>
    <div class="space-y-2">
      {#each activeGbpItems as item (item.id)}
      <div class="card overflow-hidden">
        <!-- Summary row -->
        <button
          class="w-full px-4 py-3 flex items-start justify-between gap-3 text-left hover:bg-white/[0.02] transition-colors"
          on:click={() => toggleGbpExpand(item.id)}
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-[10px] px-1.5 py-0.5 rounded border {item._type === 'offer' ? 'border-blue-500/40 text-blue-400' : 'border-purple-500/40 text-purple-400'} uppercase tracking-wide font-medium">{item._type}</span>
              <span class="text-sm font-medium text-white">{item.title}</span>
              {#if item.paused}
                <span class="text-[10px] px-1.5 py-0.5 rounded border border-yellow-500/40 text-yellow-400">Paused</span>
              {/if}
            </div>
            <div class="flex flex-wrap gap-3 mt-1 text-xs text-muted">
              {#if item._type === 'offer'}
                {#if item.recurrence !== 'none'}<span class="text-accent">↺ {item.recurrence}</span>{:else}<span>one-time (manual)</span>{/if}
              {:else}
                {#if item['recurrence'] !== 'once'}<span class="text-accent">↺ {item['recurrence']}</span>{:else}<span>one-time</span>{/if}
              {/if}
              {#if item.next_run_date}<span>Next: {item.next_run_date}</span>{/if}
              {#if item.last_posted_at}<span>Last posted: {item.last_posted_at}</span>{/if}
              {#if item.gbp_cta_type}<span>CTA: {item.gbp_cta_type}</span>{/if}
              {#if item._type === 'offer' && item['gbp_coupon_code']}<span>Code: {item['gbp_coupon_code']}</span>{/if}
              {#if item._type === 'event' && item['gbp_event_start_date']}<span>{item['gbp_event_start_date']}</span>{/if}
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {#if can('clients.edit')}
              {#if item._type === 'offer' && item.recurrence !== 'none'}
                <button class="text-xs px-2 py-0.5 rounded border {item.paused ? 'border-yellow-500 text-yellow-400' : 'border-border text-muted hover:text-white'}"
                  on:click|stopPropagation={() => togglePauseOffer(item)}
                >{item.paused ? 'Resume' : 'Pause'}</button>
              {:else if item._type === 'event' && item['recurrence'] !== 'once'}
                <button class="text-xs px-2 py-0.5 rounded border {item.paused ? 'border-yellow-500 text-yellow-400' : 'border-border text-muted hover:text-white'}"
                  on:click|stopPropagation={() => togglePauseEvent(item)}
                >{item.paused ? 'Resume' : 'Pause'}</button>
              {/if}
            {/if}
            <span class="text-muted text-xs select-none">{expandedGbpIds.has(item.id) ? '▲' : '▼'}</span>
          </div>
        </button>

        <!-- Expanded details -->
        {#if expandedGbpIds.has(item.id)}
        <div class="border-t border-border px-4 py-3 space-y-3 bg-surface/30">
          {#if item.description}
            <p class="text-xs text-white/70">{item.description}</p>
          {/if}
          <!-- Type-specific detail fields -->
          <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            {#if item._type === 'offer'}
              {#if item['valid_until']}<span>Valid until: <span class="text-white">{item['valid_until']}</span></span>{/if}
              {#if item['gbp_coupon_code']}<span>Coupon: <span class="font-mono text-white">{item['gbp_coupon_code']}</span></span>{/if}
              {#if item['gbp_redeem_url']}<span>Redeem: <a href={item['gbp_redeem_url']} target="_blank" rel="noreferrer" class="text-accent hover:underline">{item['gbp_redeem_url']}</a></span>{/if}
              {#if item['gbp_terms']}<span>Terms: {item['gbp_terms']}</span>{/if}
            {:else}
              {#if item['gbp_event_title'] && item['gbp_event_title'] !== item.title}<span>GBP title: {item['gbp_event_title']}</span>{/if}
              {#if item['gbp_event_start_date']}<span>Start: <span class="text-white">{item['gbp_event_start_date']}{item['gbp_event_start_time'] ? ' ' + item['gbp_event_start_time'] : ''}</span></span>{/if}
              {#if item['gbp_event_end_date']}<span>End: <span class="text-white">{item['gbp_event_end_date']}{item['gbp_event_end_time'] ? ' ' + item['gbp_event_end_time'] : ''}</span></span>{/if}
            {/if}
            {#if item.gbp_cta_type && item['gbp_cta_url']}<span>CTA URL: <a href={item['gbp_cta_url']} target="_blank" rel="noreferrer" class="text-accent hover:underline truncate max-w-[200px] inline-block align-bottom">{item['gbp_cta_url']}</a></span>{/if}
          </div>
          <!-- AI image brief -->
          {#if item['ai_image_prompt']}
          <div class="bg-black/20 rounded p-2.5">
            <div class="text-[10px] text-muted uppercase tracking-wide mb-1">AI Image Brief (Español)</div>
            <p class="text-xs text-white/80 font-mono leading-relaxed">{item['ai_image_prompt']}</p>
            <div class="text-[10px] text-muted mt-1">1080×1080px · GBP square</div>
          </div>
          {/if}
          <!-- Asset -->
          <div class="flex items-center gap-3 flex-wrap">
            {#if item['asset_r2_key']}
              <span class="text-xs text-green-400">✓ Image attached</span>
            {:else}
              <span class="text-xs text-muted">No image attached</span>
            {/if}
            {#if can('clients.edit')}
              <label class="btn-secondary btn-sm text-xs cursor-pointer">
                {uploadingGbpId === item.id ? 'Uploading…' : 'Upload Image'}
                <input type="file" accept="image/*,video/*" class="hidden"
                  on:change={(e) => handleGbpImageUpload(item._type === 'offer' ? 'offers' : 'events', item.id, e)}
                  disabled={uploadingGbpId === item.id}
                />
              </label>
            {/if}
          </div>
          <!-- Actions -->
          {#if can('clients.edit')}
          <div class="flex gap-2 pt-1 border-t border-border">
            <button class="btn-secondary btn-sm text-xs"
              on:click={() => { if (item._type === 'offer') startEditOffer(item); else startEditEvent(item); }}>
              Edit
            </button>
            <button class="text-xs text-muted hover:text-white px-2 py-1"
              on:click={() => { if (item._type === 'offer') toggleOffer(item); else toggleEvent(item); }}>
              Deactivate
            </button>
            <button class="btn-ghost btn-sm text-xs text-red-400"
              on:click={() => { if (item._type === 'offer') removeOffer(item.id); else removeEvent(item.id); }}>
              Remove
            </button>
          </div>
          {/if}
        </div>
        {/if}
      </div>
      {/each}
    </div>
  </div>
  {/if}

  <!-- Inactive / archived items -->
  {#if inactiveGbpItems.length > 0}
  <div class="pt-1">
    <button class="text-xs text-muted hover:text-white flex items-center gap-1.5"
      on:click={() => showInactiveGbp = !showInactiveGbp}>
      <span>{showInactiveGbp ? '▲' : '▼'}</span>
      <span>{showInactiveGbp ? 'Hide' : 'Show'} inactive ({inactiveGbpItems.length})</span>
    </button>
    {#if showInactiveGbp}
    <div class="mt-2 space-y-1.5">
      {#each inactiveGbpItems as item (item.id)}
      <div class="card px-4 py-2.5 opacity-50">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <span class="text-[10px] px-1.5 py-0.5 rounded border {item._type === 'offer' ? 'border-blue-500/30 text-blue-400' : 'border-purple-500/30 text-purple-400'} uppercase tracking-wide">{item._type}</span>
            <span class="text-sm text-white">{item.title}</span>
          </div>
          {#if can('clients.edit')}
          <div class="flex gap-2">
            <button class="text-xs text-muted hover:text-white"
              on:click={() => { if (item._type === 'offer') toggleOffer(item); else toggleEvent(item); }}>
              Reactivate
            </button>
            <button class="text-xs text-red-400 hover:text-red-300"
              on:click={() => { if (item._type === 'offer') removeOffer(item.id); else removeEvent(item.id); }}>
              Remove
            </button>
          </div>
          {/if}
        </div>
      </div>
      {/each}
    </div>
    {/if}
  </div>
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
